/* eslint-disable no-console */
import "reflect-metadata";
import { runSeeders } from "typeorm-extension";
import { AppDataSource } from "./data-source";

async function main() {
    await AppDataSource.initialize();
    try {
        await runSeeders(AppDataSource);
    } finally {
        await AppDataSource.destroy();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
