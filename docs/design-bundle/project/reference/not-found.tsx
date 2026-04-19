import { Card, CardContent } from "@/components/ui/card";
import { WarningCircle } from "@phosphor-icons/react";
import { useTranslation } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2" role="alert">
            <WarningCircle className="h-8 w-8 text-red-500" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-foreground">{t("error.pageNotFound")}</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600 dark:text-muted-foreground">
            {t("error.pageNotFoundDesc")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
