import { Link } from "react-router-dom";

/** Small "back to the hub" link shown at the top of every subpage. */
export default function BackHome() {
  return (
    <Link to="/" className="back-home">
      ← Home
    </Link>
  );
}
