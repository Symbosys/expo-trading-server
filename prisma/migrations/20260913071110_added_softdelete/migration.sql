-- AlterTable
ALTER TABLE `subscriptionplan` ADD COLUMN `isDeleted` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `isDeleted` BOOLEAN NOT NULL DEFAULT false;
