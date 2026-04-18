-- AlterTable
ALTER TABLE "ReviewRun" ADD COLUMN     "baseSha" TEXT,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "githubInstallationId" INTEGER,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'github';

-- CreateTable
CREATE TABLE "GithubInstallation" (
    "githubInstallationId" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("githubInstallationId")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "githubDeliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("githubDeliveryId")
);

-- CreateTable
CREATE TABLE "ChangedFile" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "additions" INTEGER NOT NULL,
    "deletions" INTEGER NOT NULL,
    "changes" INTEGER NOT NULL,
    "patch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangedFile_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ReviewRun" ADD CONSTRAINT "ReviewRun_githubInstallationId_fkey" FOREIGN KEY ("githubInstallationId") REFERENCES "GithubInstallation"("githubInstallationId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangedFile" ADD CONSTRAINT "ChangedFile_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
