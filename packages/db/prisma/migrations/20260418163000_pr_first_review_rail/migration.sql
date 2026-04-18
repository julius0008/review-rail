ALTER TABLE "ReviewPublication"
ADD COLUMN "reviewEvent" TEXT,
ADD COLUMN "commentsCount" INTEGER NOT NULL DEFAULT 0;
