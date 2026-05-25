import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Alert, Avatar, Button, DatePicker, Empty, Space, Spin, Table, Tag, Typography} from "antd";
import type {ColumnsType} from "antd/es/table";
import dayjs, {Dayjs} from "dayjs";
import {useNavigate} from "react-router-dom";
import {FixtureRequestClient} from "../../clients/FixtureRequestClient";
import {FixtureModel, FixtureParticipant} from "../../common/fixtures";

const client = new FixtureRequestClient();

export const FixturesByDate: React.FC = () => {
    const navigate = useNavigate();
    const [date, setDate] = useState<Dayjs>(dayjs());
    const [fixtures, setFixtures] = useState<FixtureModel[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const fetchFixtures = useCallback(async (target: Dayjs) => {
        setLoading(true);
        setError(null);
        try {
            const data = await client.getByDate(target.format("YYYY-MM-DD"));
            setFixtures(Array.isArray(data) ? data : []);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load fixtures";
            setError(message);
            setFixtures([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFixtures(date);
    }, [date, fetchFixtures]);

    const sorted = useMemo(() => sortFixtures(fixtures), [fixtures]);

    return (
        <div style={{padding: 24, maxWidth: 1100, margin: "0 auto"}}>
            <Space direction="vertical" size="large" style={{width: "100%"}}>
                <Space align="baseline" wrap style={{justifyContent: "space-between", width: "100%"}}>
                    <Space align="baseline" wrap>
                        <Typography.Title level={2} style={{margin: 0}}>Fixtures</Typography.Title>
                        <DatePicker
                            value={date}
                            onChange={(d) => d && setDate(d)}
                            allowClear={false}
                            format="YYYY-MM-DD"
                        />
                    </Space>
                    <Button type="link" onClick={() => navigate('/sessions')}>Sessions →</Button>
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
                    <div style={{textAlign: "center", padding: 48}}><Spin /></div>
                ) : sorted.length === 0 && !error ? (
                    <Empty description={`No fixtures on ${date.format("YYYY-MM-DD")}`} />
                ) : (
                    <Table<FixtureModel>
                        dataSource={sorted}
                        columns={columns}
                        rowKey="id"
                        pagination={false}
                        size="middle"
                    />
                )}
            </Space>
        </div>
    );
};

const columns: ColumnsType<FixtureModel> = [
    {
        title: "Kick-off",
        key: "kickoff",
        width: 100,
        render: (_, fixture) =>
            fixture.starting_at ? dayjs(fixture.starting_at).format("HH:mm") : "—",
    },
    {
        title: "Match",
        key: "match",
        render: (_, fixture) => {
            const home = participant(fixture, "home");
            const away = participant(fixture, "away");
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
        title: "Score",
        key: "score",
        width: 90,
        align: "center",
        render: (_, fixture) => {
            const s = currentScore(fixture);
            return s ? `${s.home} – ${s.away}` : "—";
        },
    },
    {
        title: "State",
        key: "state",
        width: 110,
        render: (_, fixture) => {
            const state = fixture.state?.state;
            const label = fixture.state?.short_name ?? fixture.state?.state ?? "—";
            return <Tag color={stateColor(state)}>{label}</Tag>;
        },
    },
    {
        title: "League",
        key: "league",
        width: 220,
        render: (_, fixture) => (
            <Space>
                {fixture.league?.image_path && (
                    <Avatar src={fixture.league.image_path} size="small" shape="square" />
                )}
                <Typography.Text>{fixture.league?.name ?? "—"}</Typography.Text>
            </Space>
        ),
    },
];

const TeamCell: React.FC<{participant?: FixtureParticipant; align: "left" | "right"}> = ({participant, align}) => {
    if (!participant) {
        return <Typography.Text type="secondary">—</Typography.Text>;
    }
    const logo = participant.image_path && (
        <Avatar src={participant.image_path} size="small" shape="square" />
    );
    return (
        <Space style={{justifyContent: align === "right" ? "flex-end" : "flex-start"}}>
            {align === "right" ? <>{participant.name ?? participant.short_code} {logo}</> : <>{logo} {participant.name ?? participant.short_code}</>}
        </Space>
    );
};

function participant(fixture: FixtureModel, location: "home" | "away"): FixtureParticipant | undefined {
    return fixture.participants?.find((p) => p.meta?.location === location);
}

function currentScore(fixture: FixtureModel): {home: number; away: number} | null {
    if (!fixture.scores) {
        return null;
    }
    const current = fixture.scores.filter((s) => s.description === "CURRENT");
    if (current.length === 0) {
        return null;
    }
    const home = current.find((s) => s.score?.participant === "home")?.score?.goals;
    const away = current.find((s) => s.score?.participant === "away")?.score?.goals;
    if (home == null && away == null) {
        return null;
    }
    return {home: home ?? 0, away: away ?? 0};
}

function sortFixtures(fixtures: FixtureModel[]): FixtureModel[] {
    return [...fixtures].sort((a, b) => {
        const leagueDiff = (a.league?.name ?? "").localeCompare(b.league?.name ?? "");
        if (leagueDiff !== 0) {
            return leagueDiff;
        }
        return (a.starting_at ?? "").localeCompare(b.starting_at ?? "");
    });
}

// Map SportMonks state codes to Antd Tag colors. Live-ish states are red,
// finished states green, postponed/abandoned amber, everything else default.
// The full list is large; unmatched states render as the default tag colour
// (no UI breakage), so this only needs the common ones.
function stateColor(state?: string): string {
    if (!state) {
        return "default";
    }
    if (state.startsWith("INPLAY_") || state === "HT" || state === "PEN_LIVE" || state === "EXTRA_TIME" || state === "LIVE") {
        return "red";
    }
    if (state === "FT" || state === "AET" || state === "FT_PEN" || state === "AWARDED") {
        return "green";
    }
    if (state === "POSTP" || state === "CANCL" || state === "ABAN" || state === "SUSPENDED" || state === "INTERRUPTED") {
        return "orange";
    }
    return "default";
}
