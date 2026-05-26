import * as dotenv from "dotenv";

// Load environment variables first
dotenv.config({ path: '../.env' });

import {Bootstrap} from "./Bootstrap"

const bootstrap = new Bootstrap();

bootstrap.boot({
    port: parseInt(process.env.PORT || "20000")
});
