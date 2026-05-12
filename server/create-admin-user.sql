-- Create admin user
-- Password hash for "yourpassword" (bcrypt)
INSERT INTO "User" (email, password, name, role, permissions, "isVerified") 
VALUES ('admin@example.com', '$2b$10$oyCMtbA1pFlrkJXzOBtTZOAkOtYOmFI./iK2XuaHa2YDQ.O4Jjjm6', 'Admin', 'ADMIN', '["full_access"]', true);
