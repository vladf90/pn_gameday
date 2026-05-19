import * as dotenv from "dotenv";

// Load environment variables first
dotenv.config({ path: '../.env' });

import {Bootstrap} from "./Bootstrap"
import {ContextFactory} from "./Logger/Context";

const bootstrap = new Bootstrap();
const ctx = ContextFactory.createProcessContext("live");

bootstrap.boot(ctx, {
    port: parseInt(process.env.PORT || "20000")
});
