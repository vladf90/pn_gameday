import React, {useCallback, useEffect, useMemo, useState} from "react";
import {
    Alert,
    Avatar,
    Button,
    Card,
    Descriptions,
    Empty,
    Input,
    Popconfirm,
    Space,
    Spin,
    Table,
    Tag,
    Tooltip,
    Typography,
    message,
} from "antd";
import type {ColumnsType} from "antd/es/table";
import dayjs from "dayjs";
import {useNavigate, useParams} from "react-router-dom";
import {SessionRequestClient, SessionDetail as SessionDetailModel} from "../../clients/SessionRequestClient";
import {FixtureModel} from "../../common/fixtures";
import {AttachFixturesPanel} from "./AttachFixturesPanel";

const client = new SessionRequestClient();

interface RouteParams {
    [key: string]: string | undefined;
    id?: string;
}

export const SessionDetail: React.FC = () => {
    const {id: idParam} = useParams<RouteParams>();
    const navigate = useNavigate();

    const sessionId = useMemo(() => {
        const n = Number(idParam);
        return Number.isFinite(n) && n > 0 ? n : null;
    }, [idParam]);

    const [session, setSession] = useState<SessionDetailModel | null>(null);
    const [liveFixtures, setLiveFixtures] = useState<FixtureModel[]>([]);
    const [missingFixtureIds, setMissingFixtureIds] = useState<number[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [endLoading, setEndLoading] = useState<boolean>(false);
    /** Per-fixture detach loading state so spinners don't gray the whole table. */
    const [detaching, setDetaching] = useState<Set<number>>(new Set());

    const fetchSession = useCallback(async () => {
        if (sessionId == null) {
            setError("Invalid session id");
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            // Two reads, in parallel: the session metadata (name, status,
            // fixture-ID list) and the live snapshot (team names, scores,
            // state). Both endpoints already cap their work at the session's
            // fixture set; running them in parallel keeps the detail page
            // snappy.
            const [detail, live] = await Promise.all([
                client.getOne(sessionId),
                client.getLive(sessionId),
            ]);
            setSession(detail);
            setLiveFixtures(live.fixtures);
            setMissingFixtureIds(live.missingFixtureIds);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to load session";
            setError(msg);
            setSession(null);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        fetchSession();
    }, [fetchSession]);

    const overlayUrl = useMemo(() => {
        if (session?.overlayUrl) {
            return session.overlayUrl;
        }
        if (session) {
            // Fallback for when PUBLIC_OVERLAY_BASE_URL is unset on the backend.
            return `${window.location.origin}/overlay/${session.id}`;
        }
        return "";
    }, [session]);

    const handleCopyOverlayUrl = useCallback(async () => {
        if (!overlayUrl) {
            return;
        }
        try {
            await navigator.clipboard.writeText(overlayUrl);
            message.success("Overlay URL copied");
        } catch {
            message.error("Could not copy URL — please copy manually");
        }
    }, [overlayUrl]);

    const handleEnd = useCallback(async () => {
        if (!session) {
            return;
        }
        setEndLoading(true);
        try {
            const updated = await client.end(session.id);
            // Preserve fixtureIds since `end` returns just the summary.
            setSession({...session, endedAt: updated.endedAt});
            message.success("Session ended");
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to end session";
            message.error(msg);
        } finally {
            setEndLoading(false);
        }
    }, [session]);

    const handleDetach = useCallback(async (fixtureId: number) => {
        if (!session) {
            return;
        }
        setDetaching(prev => new Set(prev).add(fixtureId));
        try {
            await client.detachFixture(session.id, fixtureId);
            message.success("Fixture detached");
            await fetchSession();
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to detach fixture";
            message.error(msg);
        } finally {
            setDetaching(prev => {
                const next = new Set(prev);
                next.delete(fixtureId);
                return next;
            });
        }
    }, [session, fetchSession]);

    const fixtureRows = useMemo<FixtureRow[]>(() => {
        if (!session) {
            return [];
        }
        const live = new Map(liveFixtures.map(f => [f.id, f]));
        return session.fixtureIds.map(id => ({
            fixtureId: id,
            fixture: live.get(id),
            missing: missingFixtureIds.includes(id),
        }));
    }, [session, liveFixtures, missingFixtureIds]);

    const columns = useMemo<ColumnsType<FixtureRow>>(() => ([
        {
            title: "Kick-off",
            key: "kickoff",
            width: 100,
            render: (_, row) =>
                row.fixture?.starting_at
                    ? dayjs(row.fixture.starting_at).format("YYYY-MM-DD HH:mm")
                    : "—",
        },
        {
            title: "Match",
            key: "match",
            render: (_, row) => renderMatch(row),
        },
        {
            title: "Score",
            key: "score",
            width: 90,
            align: "center",
            render: (_, row) => {
                const s = currentScore(row.fixture);
                return s ? `${s.home} – ${s.away}` : "—";
            },
        },
        {
            title: "State",
            key: "state",
            width: 110,
            render: (_, row) => {
                if (row.missing) {
                    return <Tag color="default">Not in cache</Tag>;
                }
                const short = row.fixture?.state?.short_name ?? row.fixture?.state?.state ?? "—";
                return <Tag>{short}</Tag>;
            },
        },
        {
            title: "",
            key: "action",
            width: 110,
            align: "right",
            render: (_, row) => (
                <Popconfirm
                    title="Detach this fixture?"
                    onConfirm={() => handleDetach(row.fixtureId)}
                    okText="Detach"
                    cancelText="Cancel"
                >
                    <Button size="small" danger loading={detaching.has(row.fixtureId)}>Detach</Button>
                </Popconfirm>
            ),
        },
    ]), [detaching, handleDetach]);

    if (loading) {
        return <div style={{textAlign: "center", padding: 48}}><Spin /></div>;
    }

    if (error || !session) {
        return (
            <div style={{padding: 24, maxWidth: 1100, margin: "0 auto"}}>
                <Alert
                    type="error"
                    message="Session not available"
                    description={error ?? "Unknown error"}
                    action={<Button onClick={() => navigate('/sessions')}>Back to sessions</Button>}
                    showIcon
                />
            </div>
        );
    }

    const isEnded = !!session.endedAt;

    return (
        <div style={{padding: 24, maxWidth: 1100, margin: "0 auto"}}>
            <Space direction="vertical" size="large" style={{width: "100%"}}>
                <Space align="baseline" wrap style={{justifyContent: "space-between", width: "100%"}}>
                    <Space align="baseline">
                        <Button onClick={() => navigate('/sessions')}>← Back</Button>
                        <Typography.Title level={2} style={{margin: 0}}>{session.name}</Typography.Title>
                        {isEnded
                            ? <Tag color="default">Ended</Tag>
                            : <Tag color="green">Active</Tag>}
                    </Space>
                    <Popconfirm
                        title="End this session?"
                        description="The overlay will show a 'Session ended' state on its next refresh."
                        onConfirm={handleEnd}
                        okText="End session"
                        okButtonProps={{danger: true}}
                        cancelText="Cancel"
                        disabled={isEnded}
                    >
                        <Button danger disabled={isEnded} loading={endLoading}>End session</Button>
                    </Popconfirm>
                </Space>

                <Descriptions size="small" column={2} bordered>
                    <Descriptions.Item label="Created">
                        {dayjs(session.createdAt).format("YYYY-MM-DD HH:mm")}
                    </Descriptions.Item>
                    <Descriptions.Item label="Ended">
                        {session.endedAt ? dayjs(session.endedAt).format("YYYY-MM-DD HH:mm") : "—"}
                    </Descriptions.Item>
                </Descriptions>

                <Card title="OBS overlay URL" size="small">
                    <Space.Compact style={{width: "100%"}}>
                        <Input value={overlayUrl} readOnly />
                        <Tooltip title="Paste into OBS as a Browser Source">
                            <Button onClick={handleCopyOverlayUrl}>Copy</Button>
                        </Tooltip>
                        <Button onClick={() => window.open(overlayUrl, "_blank")}>Preview</Button>
                    </Space.Compact>
                </Card>

                <Card title="Attached fixtures" size="small">
                    {fixtureRows.length === 0 ? (
                        <Empty description="No fixtures attached yet" />
                    ) : (
                        <Table<FixtureRow>
                            dataSource={fixtureRows}
                            columns={columns}
                            rowKey="fixtureId"
                            pagination={false}
                            size="small"
                        />
                    )}
                </Card>

                {!isEnded && (
                    <Card title="Add fixtures" size="small">
                        <AttachFixturesPanel
                            sessionId={session.id}
                            attachedFixtureIds={session.fixtureIds}
                            onAttached={fetchSession}
                        />
                    </Card>
                )}
            </Space>
        </div>
    );
};

interface FixtureRow {
    fixtureId: number;
    fixture?: FixtureModel;
    missing: boolean;
}

function renderMatch(row: FixtureRow): React.ReactNode {
    if (!row.fixture) {
        return <Typography.Text type="secondary">Fixture {row.fixtureId} (no snapshot yet)</Typography.Text>;
    }
    const home = row.fixture.participants?.find(p => p.meta?.location === "home");
    const away = row.fixture.participants?.find(p => p.meta?.location === "away");
    return (
        <Space size="middle">
            <PartCell name={home?.name ?? home?.short_code} logo={home?.image_path} align="right" />
            <Typography.Text type="secondary">vs</Typography.Text>
            <PartCell name={away?.name ?? away?.short_code} logo={away?.image_path} align="left" />
        </Space>
    );
}

function currentScore(fixture?: FixtureModel): {home: number; away: number} | null {
    if (!fixture?.scores) {
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

const PartCell: React.FC<{name?: string; logo?: string; align: "left" | "right"}> = ({name, logo, align}) => {
    if (!name) {
        return <Typography.Text type="secondary">—</Typography.Text>;
    }
    const avatar = logo && <Avatar src={logo} size="small" shape="square" />;
    return (
        <Space style={{justifyContent: align === "right" ? "flex-end" : "flex-start"}}>
            {align === "right" ? <>{name} {avatar}</> : <>{avatar} {name}</>}
        </Space>
    );
};
