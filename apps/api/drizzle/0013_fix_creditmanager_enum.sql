-- Re-add CREDITMANAGER to role enum (0011 may not have applied the value)
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'CREDITMANAGER';
