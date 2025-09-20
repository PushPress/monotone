-- Primary MySQL server initialization
-- Create application user
CREATE USER 'appuser'@'%' IDENTIFIED WITH mysql_native_password BY 'apppassword';
GRANT ALL PRIVILEGES ON testdb.* TO 'appuser'@'%';
GRANT REPLICATION CLIENT ON *.* TO 'appuser'@'%';
GRANT SUPER ON *.* TO 'appuser'@'%';
GRANT PROCESS ON *.* TO 'appuser'@'%';
GRANT RELOAD ON *.* TO 'appuser'@'%';

-- Create test database and table
CREATE DATABASE IF NOT EXISTS testdb;
USE testdb;
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

FLUSH PRIVILEGES;