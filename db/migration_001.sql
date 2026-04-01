-- Migration 001: Add password columns to users table
-- Run with: npx wrangler d1 execute pdfclarify --remote --file=db/migration_001.sql

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
