import React, {useCallback, useEffect, useRef, useState} from "react";
import {useParams} from "react-router-dom";
import {OverlayRequestClient, PublicOverlayResponse} from "../../clients/OverlayRequestClient";
import {FixtureModel, FixtureParticipant} from "../../common/fixtures";

const client = new OverlayRequestClient();
const POLL_INTERVAL_MS = 5000;

interface RouteParams {
    [key: string]: string | undefined;
    sessionId?: string;
}

/**
 * Public, unauthenticated overlay rendered inside OBS Browser Source.
 *
 * Three concerns:
 *   1. **No app chrome** — we render fixtures on a transparent root so OBS
 *      composites the overlay over the broadcast feed. The Antd ConfigProvider
 *      / Refine layout from `App.tsx` are bypassed by the route placement
 *      (outside `<Authenticated>` and outside the Refine resource shell).
 *   2. **Polling, not WebSocket** — keeps the contract simple. The backend's
 *      `LiveSnapshotStore` is already updated every 5s by `FixturePoller`, so
 *      a 5s client poll keeps render latency at most ~10s.
 *   3. **Stop polling when ended** — once `endedAt` is set we render a
 *      "Session ended" state and clear the timer; OBS keeps the static
 *      message visible until the host removes the Browser Source.
 */
export const OverlayPage: React.FC = () => {
    const {sessionId: sessionIdParam} = useParams<RouteParams>();
    const sessionId = Number(sessionIdParam);
    const valid = Number.isFinite(sessionId) && sessionId > 0;

    const [data, setData] = useState<PublicOverlayResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    /** Hold the timer id on a ref so the cleanup in `useEffect` clears the
     *  active timer rather than a stale closure. */
    const timerRef = useRef<number | null>(null);

    // OBS browser sources expect transparent compositing. Inject the styles
    // here so the rest of the app (which has a white Antd background) isn't
    // affected, and so the public overlay works regardless of how App.tsx
    // wraps things. Revert on unmount.
    useEffect(() => {
        const prevBg = document.body.style.backgroundColor;
        const prevHtmlBg = document.documentElement.style.backgroundColor;
        document.body.style.backgroundColor = "transparent";
        document.documentElement.style.backgroundColor = "transparent";
        return () => {
            document.body.style.backgroundColor = prevBg;
            document.documentElement.style.backgroundColor = prevHtmlBg;
        };
    }, []);

    const fetchOnce = useCallback(async () => {
        if (!valid) {
            setError("Invalid session id");
            return;
        }
        try {
            const response = await client.fetch(sessionId);
            setData(response);
            setError(null);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to load overlay";
            setError(msg);
        }
    }, [valid, sessionId]);

    useEffect(() => {
        fetchOnce();
    }, [fetchOnce]);

    useEffect(() => {
        if (!valid) {
            return;
        }
        // Don't poll once the session has ended — the response is stable.
        if (data?.endedAt) {
            return;
        }
        const id = window.setInterval(fetchOnce, POLL_INTERVAL_MS);
        timerRef.current = id;
        return () => {
            if (timerRef.current !== null) {
                window.clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [valid, data?.endedAt, fetchOnce]);

    if (!valid) {
        return <OverlayMessage tone="error">Invalid session id</OverlayMessage>;
    }

    if (error && !data) {
        return <OverlayMessage tone="error">{error}</OverlayMessage>;
    }

    if (!data) {
        return <OverlayMessage tone="info">Loading…</OverlayMessage>;
    }

    if (data.endedAt) {
        return <OverlayMessage tone="ended">{data.name} — Session ended</OverlayMessage>;
    }

    if (data.fixtures.length === 0) {
        return <OverlayMessage tone="info">{data.name} — waiting for fixtures…</OverlayMessage>;
    }

    return (
        <div style={overlayContainerStyle}>
            {data.fixtures.map(fixture => (
                <FixtureRow key={fixture.id} fixture={fixture} />
            ))}
        </div>
    );
};

const FixtureRow: React.FC<{fixture: FixtureModel}> = ({fixture}) => {
    const home = fixture.participants?.find(p => p.meta?.location === "home");
    const away = fixture.participants?.find(p => p.meta?.location === "away");
    const score = currentScore(fixture);
    const stateLabel = fixture.state?.short_name ?? fixture.state?.state ?? "";

    return (
        <div style={rowStyle}>
            <ParticipantCell participant={home} align="right" />
            <div style={scoreStyle}>
                {score ? `${score.home} – ${score.away}` : "—"}
            </div>
            <ParticipantCell participant={away} align="left" />
            {stateLabel && <div style={stateStyle}>{stateLabel}</div>}
        </div>
    );
};

const ParticipantCell: React.FC<{participant?: FixtureParticipant; align: "left" | "right"}> = ({participant, align}) => {
    if (!participant) {
        return <div style={{...participantStyle, justifyContent: align === "right" ? "flex-end" : "flex-start"}}>—</div>;
    }
    const name = participant.name ?? participant.short_code ?? "";
    const logo = participant.image_path
        ? <img src={participant.image_path} alt="" style={logoStyle} />
        : null;
    return (
        <div style={{...participantStyle, justifyContent: align === "right" ? "flex-end" : "flex-start"}}>
            {align === "right" ? <>{name} {logo}</> : <>{logo} {name}</>}
        </div>
    );
};

const OverlayMessage: React.FC<{tone: "info" | "error" | "ended"; children: React.ReactNode}> = ({tone, children}) => {
    const colour = tone === "error" ? "#ff4d4f" : tone === "ended" ? "#888" : "#fff";
    return (
        <div style={{...messageStyle, color: colour}}>
            {children}
        </div>
    );
};

function currentScore(fixture: FixtureModel): {home: number; away: number} | null {
    if (!fixture.scores) {
        return null;
    }
    const current = fixture.scores.filter(s => s.description === "CURRENT");
    if (current.length === 0) {
        return null;
    }
    const home = current.find(s => s.score?.participant === "home")?.score?.goals;
    const away = current.find(s => s.score?.participant === "away")?.score?.goals;
    if (home == null && away == null) {
        return null;
    }
    return {home: home ?? 0, away: away ?? 0};
}

// Styles are inline (no extra CSS file) so the overlay is fully self-contained
// — easier to reason about against an OBS Browser Source preview.

const overlayContainerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 24,
    fontFamily: "'Inter', system-ui, sans-serif",
    color: "#fff",
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.7)",
};

const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr auto",
    alignItems: "center",
    gap: 16,
    background: "rgba(0, 0, 0, 0.55)",
    padding: "10px 16px",
    borderRadius: 6,
    fontSize: 20,
    fontWeight: 600,
};

const participantStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
};

const logoStyle: React.CSSProperties = {
    width: 24,
    height: 24,
    objectFit: "contain",
};

const scoreStyle: React.CSSProperties = {
    minWidth: 64,
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
};

const stateStyle: React.CSSProperties = {
    minWidth: 56,
    textAlign: "right",
    fontSize: 14,
    fontWeight: 500,
    opacity: 0.8,
};

const messageStyle: React.CSSProperties = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 20,
    padding: 24,
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.7)",
};
