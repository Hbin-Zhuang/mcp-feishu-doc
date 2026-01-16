/**
 * @fileoverview Registers core application services with the DI container.
 * This module encapsulates the registration of fundamental services such as
 * configuration, logging, storage, and rate limiting.
 * @module src/container/registrations/core
 */
import { container, Lifecycle } from 'tsyringe';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Surreal from 'surrealdb';

import { parseConfig } from '@/config/index.js';
import {
  AppConfig,
  Logger,
  RateLimiterService,
  StorageProvider,
  StorageService,
  SupabaseAdminClient,
  SurrealdbClient,
} from '@/container/tokens.js';
import { StorageService as StorageServiceClass } from '@/storage/core/StorageService.js';
import { createStorageProvider } from '@/storage/core/storageFactory.js';
import type { Database } from '@/storage/providers/supabase/supabase.types.js';
import { JsonRpcErrorCode, McpError } from '@/types-global/errors.js';
import { logger } from '@/utils/index.js';
import { RateLimiter } from '@/utils/security/rateLimiter.js';

/**
 * Registers core application services and values with the tsyringe container.
 */
export const registerCoreServices = () => {
  // Configuration (parsed and registered as a static value)
  const config = parseConfig();
  container.register(AppConfig, { useValue: config });

  // Logger (as a static value)
  container.register(Logger, { useValue: logger });

  type AppConfigType = ReturnType<typeof parseConfig>;

  container.register<SupabaseClient<Database>>(SupabaseAdminClient, {
    useFactory: (c) => {
      const cfg = c.resolve<AppConfigType>(AppConfig);
      if (!cfg.supabase?.url || !cfg.supabase?.serviceRoleKey) {
        throw new McpError(
          JsonRpcErrorCode.ConfigurationError,
          'Supabase URL or service role key is missing for admin client.',
        );
      }
      return createClient<Database>(
        cfg.supabase.url,
        cfg.supabase.serviceRoleKey,
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
    },
  });

  // Register SurrealDB client
  // Note: Since tsyringe doesn't support async factories, we create a promise-wrapped instance
  container.register<Surreal>(SurrealdbClient, {
    useFactory: (c) => {
      const cfg = c.resolve<AppConfigType>(AppConfig);
      if (
        !cfg.surrealdb?.url ||
        !cfg.surrealdb?.namespace ||
        !cfg.surrealdb?.database
      ) {
        throw new McpError(
          JsonRpcErrorCode.ConfigurationError,
          'SurrealDB URL, namespace, and database are required for SurrealDB client.',
        );
      }

      const db = new Surreal();

      // Connect asynchronously (the connection will be established when first used)
      db.connect(cfg.surrealdb.url, {
        namespace: cfg.surrealdb.namespace,
        database: cfg.surrealdb.database,
        ...(cfg.surrealdb.username &&
          cfg.surrealdb.password && {
            auth: {
              username: cfg.surrealdb.username,
              password: cfg.surrealdb.password,
            },
          }),
      })
        .then(() => {
          logger.info('Connected to SurrealDB');
        })
        .catch((err: Error) => {
          logger.error('Failed to connect to SurrealDB', {
            requestId: 'surrealdb-init',
            timestamp: new Date().toISOString(),
            operation: 'SurrealDB.connect',
            error: err instanceof Error ? err.message : String(err),
          });
        });

      return db;
    },
  });

  // --- Refactored Storage Service Registration ---
  // 1. Register the factory for the concrete provider against the provider token.
  // This factory depends on the AppConfig, which is already registered.
  container.register(StorageProvider, {
    useFactory: (c) => createStorageProvider(c.resolve(AppConfig)),
  });

  // 2. Register StorageServiceClass against the service token.
  //    tsyringe will automatically inject the StorageProvider dependency.
  container.register(
    StorageService,
    { useClass: StorageServiceClass },
    { lifecycle: Lifecycle.Singleton },
  );
  // --- End Refactor ---

  // Register RateLimiter as a singleton service
  container.register<RateLimiter>(
    RateLimiterService,
    { useClass: RateLimiter },
    { lifecycle: Lifecycle.Singleton },
  );

  logger.info('Core services registered with the DI container.');
};
