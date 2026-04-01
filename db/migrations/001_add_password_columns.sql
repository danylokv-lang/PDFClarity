-- Migration 001: Add password columns to users table
-- Run with: npx wrangler d1 execute pdfclarify-db --remote --file=db/migrations/001_add_password_columns.sql

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
