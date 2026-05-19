import { Repository } from "typeorm";
import { User } from "../entities/User";
import { UserModel } from "../../common/models";
import { AppDataSource } from "../data-source";

export class UserRepository {
    private repository: Repository<User>;

    constructor() {
        this.repository = AppDataSource.getRepository(User);
    }

    async getUser(username: string): Promise<UserPassword | undefined> {
        const user = await this.repository.findOne({
            where: { username },
            select: ["id", "username", "password", "role"]
        });
        if (user) {
            return {
                id: user.id,
                username: user.username,
                password: user.password,
                role: user.role,
            };
        }
        return undefined;
    }

    async getUserById(userId: number): Promise<UserModel | undefined> {
        const user = await this.repository.findOne({
            where: { id: userId },
            select: ["id", "username", "firstName", "lastName"]
        });
        if (user) {
            return {
                id: user.id,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                avatarUrl: ""
            };
        }
        return undefined;
    }

    async insertUser(username: string, password: string, firstName: string, lastName: string, email: string, role: string = 'user'): Promise<void> {
        const user = new User();
        user.username = username;
        user.password = password;
        user.firstName = firstName;
        user.lastName = lastName;
        user.email = email;
        user.role = role;
        await this.repository.save(user);
    }
}

export interface UserPassword {
    id: number;
    username: string;
    password: string;
    role: string;
}
