/*
  Warnings:

  - You are about to drop the column `owner_Id` on the `Folder` table. All the data in the column will be lost.
  - Added the required column `owner_id` to the `Folder` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Folder" DROP CONSTRAINT "Folder_owner_Id_fkey";

-- AlterTable
ALTER TABLE "Folder" DROP COLUMN "owner_Id",
ADD COLUMN     "owner_id" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
