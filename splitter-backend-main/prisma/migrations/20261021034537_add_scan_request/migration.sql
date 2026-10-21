-- CreateTable
CREATE TABLE "public"."ScanRequest" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "imageHash" TEXT NOT NULL,
    "idemKey" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "charged" BOOLEAN NOT NULL DEFAULT false,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanRequest_userId_createdAt_idx" ON "public"."ScanRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ScanRequest_userId_imageHash_idx" ON "public"."ScanRequest"("userId", "imageHash");

-- CreateIndex
CREATE UNIQUE INDEX "ScanRequest_userId_idemKey_key" ON "public"."ScanRequest"("userId", "idemKey");

-- AddForeignKey
ALTER TABLE "public"."ScanRequest" ADD CONSTRAINT "ScanRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
