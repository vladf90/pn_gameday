/* eslint-disable no-console */
import { DataSource } from "typeorm";
import { Seeder } from "typeorm-extension";
import * as bcrypt from "bcrypt";
import { User } from "../entities/User";

export default class UserSeeder implements Seeder {
    async run(dataSource: DataSource): Promise<void> {
        const username = process.env.SEED_USER_USERNAME;
        const password = process.env.SEED_USER_PASSWORD;

        if (!username || !password) {
            console.log("UserSeeder: SEED_USER_USERNAME / SEED_USER_PASSWORD not set — skipping");
            return;
        }

        const repo = dataSource.getRepository(User);
        const existing = await repo.findOne({ where: { username } });
        if (existing) {
            console.log(`UserSeeder: user "${username}" already exists — skipping`);
            return;
        }

        const hashed = await bcrypt.hash(password, 10);
        await repo.insert({
            username,
            password: hashed,
            email: username,
            firstName: "Admin",
            lastName: "User",
            role: "admin",
        });
        console.log(`UserSeeder: created user "${username}"`);
    }
}
