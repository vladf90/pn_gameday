import React from "react";
import { Typography } from "antd";

export const Home: React.FC = () => {
    return (
        <div style={{ padding: 24 }}>
            <Typography.Title level={2}>pn_gameday</Typography.Title>
            <Typography.Paragraph>
                Skeleton ready. Add resources in <code>App.tsx</code>, request clients in
                <code> src/clients/</code>, and components under <code>src/Components/</code>.
            </Typography.Paragraph>
        </div>
    );
};
