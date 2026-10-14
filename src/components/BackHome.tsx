import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

/** Small "back to the hub" link shown at the top of every subpage. */
export default function BackHome() {
  const { t } = useTranslation();
  return (
    <Link to="/" className="back-home">
      {t("common.backHome")}
    </Link>
  );
}
