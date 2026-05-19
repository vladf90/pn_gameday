import React from "react";
import { AuthPage } from "@refinedev/antd";

export const Login: React.FC = () => {
    return (
        <AuthPage
            type="login"
            rememberMe={false}
            registerLink={false}
            forgotPasswordLink={false}
        />
    );
};
