-- CreateTable
CREATE TABLE "BlackFridayBannerConfig" (
    "id" TEXT NOT NULL,
    "modoManual" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByEmail" TEXT,

    CONSTRAINT "BlackFridayBannerConfig_pkey" PRIMARY KEY ("id")
);
