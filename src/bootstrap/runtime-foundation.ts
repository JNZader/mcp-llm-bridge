import type Database from "better-sqlite3";

import { loadConfig } from "../core/config.js";
import { Router } from "../core/router.js";
import { type GatewayConfig } from "../core/types.js";
import { migrate } from "../db/migrate.js";
import { Vault } from "../vault/index.js";
import { createCoreServices, type CoreServices } from "./core-services.js";

export interface RuntimeFoundation {
	config: GatewayConfig;
	vault: Vault;
	router: Router;
	db: Database.Database;
	coreServices: CoreServices;
}

export async function createRuntimeFoundation(): Promise<RuntimeFoundation> {
	const config = loadConfig();
	const vault = new Vault(config);
	const router = new Router();

	const db = vault.getDb();

	await migrate({ dbPath: config.dbPath });

	const coreServices = createCoreServices({
		db,
		dbPath: config.dbPath,
	});

	return {
		config,
		vault,
		router,
		db,
		coreServices,
	};
}
