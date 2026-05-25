import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Alert, Button, Empty, Form, Input, Modal, Space, Spin, Switch, Table, Tag, Typography} from "antd";
import type {ColumnsType} from "antd/es/table";
import dayjs from "dayjs";
import {useNavigate} from "react-router-dom";
import {SessionRequestClient, SessionStatusFilter, SessionSummary} from "../../clients/SessionRequestClient";

const client = new SessionRequestClient();

export const SessionsList: React.FC = () => {
    const navigate = useNavigate();

    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    /** Switch toggles between 'active' (default) and 'all'. */
    const [showEnded, setShowEnded] = useState<boolean>(false);
    const [createOpen, setCreateOpen] = useState<boolean>(false);
    const [creating, setCreating] = useState<boolean>(false);
    const [form] = Form.useForm<{name: string}>();

    const status: SessionStatusFilter = showEnded ? 'all' : 'active';

    const fetchSessions = useCallback(async (filter: SessionStatusFilter) => {
        setLoading(true);
        setError(null);
        try {
            const data = await client.list(filter);
            setSessions(Array.isArray(data) ? data : []);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load sessions";
            setError(message);
            setSessions([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSessions(status);
    }, [status, fetchSessions]);

    const onCreate = useCallback(async () => {
        try {
            const values = await form.validateFields();
            setCreating(true);
            const created = await client.create(values.name.trim());
            setCreateOpen(false);
            form.resetFields();
            navigate(`/sessions/${created.id}`);
        } catch (e) {
            // validateFields throws an object with errorFields — only show a
            // toast for actual network failures, not for form-validation cancels.
            if (e instanceof Error) {
                setError(e.message);
            }
        } finally {
            setCreating(false);
        }
    }, [form, navigate]);

    const columns = useMemo<ColumnsType<SessionSummary>>(() => ([
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            render: (name: string, s) => (
                <Button type="link" style={{padding: 0}} onClick={() => navigate(`/sessions/${s.id}`)}>
                    {name}
                </Button>
            ),
        },
        {
            title: "Status",
            key: "status",
            width: 110,
            render: (_, s) =>
                s.endedAt
                    ? <Tag color="default">Ended</Tag>
                    : <Tag color="green">Active</Tag>,
        },
        {
            title: "Created",
            dataIndex: "createdAt",
            key: "createdAt",
            width: 170,
            render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
        },
        {
            title: "Ended",
            dataIndex: "endedAt",
            key: "endedAt",
            width: 170,
            render: (v: string | null) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—",
        },
    ]), [navigate]);

    return (
        <div style={{padding: 24, maxWidth: 1100, margin: "0 auto"}}>
            <Space direction="vertical" size="large" style={{width: "100%"}}>
                <Space align="baseline" wrap style={{justifyContent: "space-between", width: "100%"}}>
                    <Typography.Title level={2} style={{margin: 0}}>Sessions</Typography.Title>
                    <Space align="center">
                        <Typography.Text type="secondary">Show ended</Typography.Text>
                        <Switch checked={showEnded} onChange={setShowEnded} />
                        <Button type="primary" onClick={() => setCreateOpen(true)}>New session</Button>
                    </Space>
                </Space>

                {error && (
                    <Alert
                        type="error"
                        message="Could not load sessions"
                        description={error}
                        action={<Button onClick={() => fetchSessions(status)}>Retry</Button>}
                        showIcon
                    />
                )}

                {loading ? (
                    <div style={{textAlign: "center", padding: 48}}><Spin /></div>
                ) : sessions.length === 0 && !error ? (
                    <Empty description={showEnded ? "No sessions yet" : "No active sessions"} />
                ) : (
                    <Table<SessionSummary>
                        dataSource={sessions}
                        columns={columns}
                        rowKey="id"
                        pagination={false}
                        size="middle"
                    />
                )}
            </Space>

            <Modal
                title="New session"
                open={createOpen}
                onCancel={() => { setCreateOpen(false); form.resetFields(); }}
                onOk={onCreate}
                okText="Create"
                confirmLoading={creating}
                destroyOnClose
            >
                <Form form={form} layout="vertical" preserve={false}>
                    <Form.Item
                        name="name"
                        label="Name"
                        rules={[
                            {required: true, message: "Name is required"},
                            {whitespace: true, message: "Name cannot be blank"},
                        ]}
                    >
                        <Input autoFocus placeholder="Saturday Premier League watchalong" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
