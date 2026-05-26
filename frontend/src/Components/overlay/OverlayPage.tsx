import React, {useEffect, useRef, useState} from "react";
import {useParams, useSearchParams} from "react-router-dom";
import {
    OverlayRequestClient,
    PublicOverlayStreamMessage,
} from "../../clients/OverlayRequestClient";
import {FixtureModel, FixtureParticipant} from "../../common/fixtures";
import {
    TimerMode,
    computeTimerMode,
    reconcileTimerMode,
} from "../../common/matchTimer";
import {MatchTimer} from "./MatchTimer";

const client = new OverlayRequestClient();

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
 *   2. **SSE, not polling** (ADR 0006). The backend pushes a fresh frame on
 *      every FixturePoller tick (~5s) plus an immediate frame on connect, so
 *      first paint is fast and score changes show up within ~1s of the
 *      backend snapshot updating.
 *   3. **No "session ended" message.** Per ADR 0006 §4, when the server
 *      closes the stream after a session ends, we leave whatever final
 *      frame was last delivered on screen. The host's broadcast keeps the
 *      static final-score frame visible until they remove the Browser Source.
 */
export const OverlayPage: React.FC = () => {
    const {sessionId: sessionIdParam} = useParams<RouteParams>();
    const sessionId = Number(sessionIdParam);
    // Per-session capability token (ADR 0008). Without it the server 404s
    // the SSE handshake; short-circuit here so we don't open a doomed
    // EventSource (which would also surface as an opaque `onerror`).
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token") ?? "";
    const valid = Number.isFinite(sessionId) && sessionId > 0 && token.length > 0;

    const [data, setData] = useState<PublicOverlayStreamMessage | null>(null);
    const [error, setError] = useState<string | null>(null);
    /**
     * Per-fixture-id timer mode. We hold this in state (and reconcile it via
     * `reconcileTimerMode` on each frame) so smooth ticking survives across
     * server pushes — see ADR 0006 §3. A fresh `Map` reference is committed
     * on each update so React detects the change.
     */
    const [timerModes, setTimerModes] = useState<Map<number, TimerMode>>(() => new Map());
    /**
     * Local 1Hz ticker so `MM:SS` advances visibly between SSE frames. One
     * shared interval drives every `MatchTimer` to avoid N independent
     * timers for N fixtures.
     */
    const [now, setNow] = useState<number>(() => Date.now());

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

    // 1Hz clock for the timer chips. `setNow(Date.now())` is the only thing
    // that advances the displayed seconds between SSE frames; the helper
    // `formatRunningClock` reads `now` and computes elapsed against the
    // reference captured on the last frame.
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);

    // Hold the EventSource on a ref so the cleanup closes the active source
    // (not a stale closure from an earlier render).
    const sourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        if (!valid) {
            setError("Invalid overlay link");
            return;
        }
        const source = client.subscribeStream(sessionId, token, {
            onMessage: (payload) => {
                setData(payload);
                setError(null);
                // Reconcile timer modes against the previous map so smooth
                // ticking is preserved across frames (see ADR 0006 §3).
                setTimerModes((prev) => {
                    const next = new Map<number, TimerMode>();
                    const nowMs = Date.now();
                    for (const fixture of payload.fixtures) {
                        const fresh = computeTimerMode(fixture, payload.serverTime);
                        const prior = prev.get(fixture.id) ?? null;
                        next.set(fixture.id, reconcileTimerMode(prior, fresh, nowMs));
                    }
                    return next;
                });
            },
            onClose: () => {
                // ADR 0006 §4: server hung up after a final frame. We
                // intentionally do NOT clear `data` — the last snapshot
                // stays on screen for the host's broadcast.
            },
        });
        sourceRef.current = source;
        return () => {
            source.close();
            sourceRef.current = null;
        };
    }, [valid, sessionId, token]);

    if (!valid) {
        return <OverlayMessage tone="error">Invalid overlay link</OverlayMessage>;
    }

    if (error && !data) {
        return <OverlayMessage tone="error">{error}</OverlayMessage>;
    }

    if (!data) {
        return <OverlayMessage tone="info">Loading…</OverlayMessage>;
    }

    if (data.fixtures.length === 0) {
        // No fixtures attached yet — but we keep this rendering even after
        // the stream closes, since ADR §4 says the last frame stays on
        // screen. A truly-empty session just shows the waiting message.
        return <OverlayMessage tone="info">{data.name} — waiting for fixtures…</OverlayMessage>;
    }

    return (
        <div style={overlayContainerStyle}>
            {data.fixtures.map(fixture => (
                <FixtureRow
                    key={fixture.id}
                    fixture={fixture}
                    timerMode={timerModes.get(fixture.id)}
                    now={now}
                />
            ))}
        </div>
    );
};

interface FixtureRowProps {
    fixture: FixtureModel;
    timerMode: TimerMode | undefined;
    now: number;
}

const FixtureRow: React.FC<FixtureRowProps> = ({fixture, timerMode, now}) => {
    const home = fixture.participants?.find(p => p.meta?.location === "home");
    const away = fixture.participants?.find(p => p.meta?.location === "away");
    const score = currentScore(fixture);

    return (
        <div style={rowStyle}>
            <ParticipantCell participant={home} align="right" />
            <div style={scoreStyle}>
                {score ? `${score.home} – ${score.away}` : "—"}
            </div>
            <ParticipantCell participant={away} align="left" />
            {timerMode && <MatchTimer style={stateStyle} mode={timerMode} now={now} />}
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
    minWidth: 72,
    textAlign: "right",
    fontSize: 14,
    fontWeight: 500,
    opacity: 0.8,
    fontVariantNumeric: "tabular-nums",
};

const messageStyle: React.CSSProperties = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 20,
    padding: 24,
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.7)",
};
