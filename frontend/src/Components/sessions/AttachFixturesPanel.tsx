import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Alert, Avatar, Button, DatePicker, Empty, Space, Spin, Table, Tag, Typography, message} from "antd";
import type {ColumnsType} from "antd/es/table";
import dayjs, {Dayjs} from "dayjs";
import {FixtureRequestClient} from "../../clients/FixtureRequestClient";
import {SessionRequestClient} from "../../clients/SessionRequestClient";
import {FixtureModel, FixtureParticipant} from "../../common/fixtures";

const fixtureClient = new FixtureRequestClient();
const sessionClient = new SessionRequestClient();

interface Props {
    sessionId: number;
    /** Fixture IDs already attached — used to disable the Attach button. */
    attachedFixtureIds: number[];
    /** Called after a successful attach so the parent can refetch. */
    onAttached: () => void;
}

/**
 * Date-picker + fixtures list with an "Attach" action per row. Fetches the
 * same `/fixtures?date=` endpoint as the standalone FixturesByDate view but
 * scoped to a session — fixtures already attached render as disabled.
 */
export const AttachFixturesPanel: React.FC<Props> = ({sessionId, attachedFixtureIds, onAttached}) => {
    const [date, setDate] = useState<Dayjs>(dayjs());
    const [fixtures, setFixtures] = useState<FixtureModel[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    /** Per-fixture attaching state so a single "Attach" click doesn't gray the whole table. */
    const [attaching, setAttaching] = useState<Set<number>>(new Set());

    const attachedSet = useMemo(() => new Set(attachedFixtureIds), [attachedFixtureIds]);

    const fetchFixtures = useCallback(async (target: Dayjs) => {
        setLoading(true);
        setError(null);
        try {
            const data = await fixtureClient.getByDate(target.format("YYYY-MM-DD"));
            setFixtures(Array.isArray(data) ? data : []);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to load fixtures";
            setError(msg);
            setFixtures([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFixtures(date);
    }, [date, fetchFixtures]);

    const handleAttach = useCallback(async (fixtureId: number) => {
        setAttaching(prev => new Set(prev).add(fixtureId));
        try {
            await sessionClient.attachFixture(sessionId, fixtureId);
            message.success("Fixture attached");
            onAttached();
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to attach fixture";
            message.error(msg);
        } finally {
            setAttaching(prev => {
                const next = new Set(prev);
                next.delete(fixtureId);
                return next;
            });
        }
    }, [sessionId, onAttached]);

    const columns = useMemo<ColumnsType<FixtureModel>>(() => ([
        {
            title: "Kick-off",
            key: "kickoff",
            width: 100,
            render: (_, f) => f.starting_at ? dayjs(f.starting_at).format("HH:mm") : "—",
        },
        {
            title: "Match",
            key: "match",
            render: (_, f) => {
                const home = f.participants?.find(p => p.meta?.location === "home");
                const away = f.participants?.find(p => p.meta?.location === "away");
                return (
                    <Space size="middle">
                        <TeamCell participant={home} align="right" />
                        <Typography.Text type="secondary">vs</Typography.Text>
                        <TeamCell participant={away} align="left" />
                    </Space>
                );
            },
        },
        {
            title: "State",
            key: "state",
            width: 100,
            render: (_, f) => <Tag>{f.state?.short_name ?? f.state?.state ?? "—"}</Tag>,
        },
        {
            title: "",
            key: "action",
            width: 140,
            align: "right",
            render: (_, f) => {
                const already = attachedSet.has(f.id);
                return (
                    <Button
                        size="small"
                        type="primary"
                        disabled={already}
                        loading={attaching.has(f.id)}
                        onClick={() => handleAttach(f.id)}
                    >
                        {already ? "Attached" : "Attach"}
                    </Button>
                );
            },
        },
    ]), [attachedSet, attaching, handleAttach]);

    return (
        <Space direction="vertical" size="middle" style={{width: "100%"}}>
            <Space align="baseline">
                <Typography.Text strong>Date</Typography.Text>
                <DatePicker
                    value={date}
                    onChange={(d) => d && setDate(d)}
                    allowClear={false}
                    format="YYYY-MM-DD"
                />
            </Space>

            {error && (
                <Alert
                    type="error"
                    message="Could not load fixtures"
                    description={error}
                    action={<Button onClick={() => fetchFixtures(date)}>Retry</Button>}
                    showIcon
                />
            )}

            {loading ? (
                <div style={{textAlign: "center", padding: 24}}><Spin /></div>
            ) : fixtures.length === 0 && !error ? (
                <Empty description={`No fixtures on ${date.format("YYYY-MM-DD")}`} />
            ) : (
                <Table<FixtureModel>
                    dataSource={fixtures}
                    columns={columns}
                    rowKey="id"
                    pagination={{pageSize: 10}}
                    size="small"
                />
            )}
        </Space>
    );
};

const TeamCell: React.FC<{participant?: FixtureParticipant; align: "left" | "right"}> = ({participant, align}) => {
    if (!participant) {
        return <Typography.Text type="secondary">—</Typography.Text>;
    }
    const logo = participant.image_path && (
        <Avatar src={participant.image_path} size="small" shape="square" />
    );
    return (
        <Space style={{justifyContent: align === "right" ? "flex-end" : "flex-start"}}>
            {align === "right"
                ? <>{participant.name ?? participant.short_code} {logo}</>
                : <>{logo} {participant.name ?? participant.short_code}</>}
        </Space>
    );
};
