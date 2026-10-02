import { Link } from "react-router-dom";

interface Card {
  to: string;
  title: string;
  description: string;
  featured?: boolean;
}

interface Group {
  title: string;
  items: Card[];
}

const GROUPS: Group[] = [
  {
    title: "Overview",
    items: [
      {
        to: "/dashboard",
        title: "Dashboard",
        description: "Monthly and annual totals, settlement, and each person's income split.",
        featured: true,
      },
    ],
  },
  {
    title: "Money",
    items: [
      {
        to: "/expenses",
        title: "Expenses & Savings",
        description: "Register common or individual spending — or money saved into investments.",
      },
      {
        to: "/income",
        title: "Income",
        description: "Each person's income; it sets their fair share of shared costs.",
      },
      {
        to: "/bills",
        title: "Bills",
        description: "Common and personal bills, counted as paid when registered.",
      },
      {
        to: "/planned",
        title: "Planned",
        description: "A wishlist of future purchases with links, ready to turn into expenses.",
      },
    ],
  },
  {
    title: "Review",
    items: [
      {
        to: "/history",
        title: "History of Expenses & Investments",
        description: "Every registered entry, grouped by month and filterable by type and category.",
      },
    ],
  },
  {
    title: "Setup",
    items: [
      {
        to: "/settings",
        title: "Settings",
        description: "People, categories, and JSON export/import.",
      },
    ],
  },
];

export default function HomePage() {
  return (
    <div>
      <header className="home-head">
        <h1 className="home-brand">Expense Tracker</h1>
        <p className="subtitle">Choose where to go.</p>
      </header>

      {GROUPS.map((group) => (
        <section key={group.title} className="home-group">
          <h2 className="home-group-title">{group.title}</h2>
          <div className="home-grid">
            {group.items.map((card) => (
              <Link
                key={card.to}
                to={card.to}
                className={card.featured ? "home-card featured" : "home-card"}
              >
                <span className="home-card-title">{card.title}</span>
                <span className="home-card-desc">{card.description}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <p className="home-foot">
        The Investments tab is archived. Money moved into investments is now registered as
        “Saved into investments” under Expenses &amp; Savings.
      </p>
    </div>
  );
}
