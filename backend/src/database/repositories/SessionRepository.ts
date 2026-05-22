import { Repository } from "typeorm";
import { Session } from "../entities/Session";
import { AppDataSource } from "../data-source";

export class SessionRepository {
    private repository: Repository<Session>;

    constructor() {
        this.repository = AppDataSource.getRepository(Session);
    }

    async findAll(): Promise<Session[]> {
        return this.repository.find({ order: { id: "ASC" } });
    }

    async findById(id: number): Promise<Session | null> {
        return this.repository.findOne({ where: { id } });
    }

    async create(name: string): Promise<Session> {
        const session = new Session();
        session.name = name;
        return this.repository.save(session);
    }

    async update(id: number, fields: { name?: string }): Promise<Session | null> {
        const session = await this.findById(id);
        if (!session) {
            return null;
        }
        if (fields.name !== undefined) {
            session.name = fields.name;
        }
        return this.repository.save(session);
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.repository.delete({ id });
        return (result.affected ?? 0) > 0;
    }
}
