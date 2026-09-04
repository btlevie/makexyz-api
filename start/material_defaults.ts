/**
 * Fails server boot immediately if a technology has no default material
 * configured, rather than a customer discovering it as a 500 on their first
 * upload. Registered `environment: ['web']` in adonisrc.ts, so it only runs
 * for the real server - migrations, seeders, and the test suite all run
 * against a database that may not be seeded yet and shouldn't be blocked by
 * this check.
 */
import { assertDefaultMaterialsConfigured } from '#services/material_service'

await assertDefaultMaterialsConfigured()
