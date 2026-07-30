-- Separate database for the Jest/Supertest suite (Sprint 1, Day 5).
-- Keeping tests off the dev database means a test run can drop and re-migrate
-- freely without destroying local dev data.
CREATE DATABASE trustlance_test OWNER trustlance;
