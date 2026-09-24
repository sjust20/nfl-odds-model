import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import { HowPage } from "./pages/HowPage";
import { MatchupPage } from "./pages/MatchupPage";
import { RankingsPage } from "./pages/RankingsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LabPage } from "./pages/StrategyLab";
import { TeamPage } from "./pages/TeamPage";
import { WeekPage } from "./pages/WeekPage";
import { AppProvider, useApp } from "./state";

const NAV = [
  ["/", "This week"],
  ["/rankings", "Rankings"],
  ["/team", "Teams"],
  ["/matchup", "Matchup"],
] as const;

const NAV_SECONDARY = [
  ["/how", "How it works"],
  ["/lab", "Strategy lab"],
] as const;

function Shell() {
  const { data, run, running, error } = useApp();
  const updated = data ? new Date(data.updatedAt) : null;
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">NFL Line Model</span>
          {updated && (
            <span className="muted small">
              Data {updated.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
              {updated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              {label}
            </NavLink>
          ))}
        </nav>
        <nav className="nav nav-secondary" aria-label="About the model">
          {NAV_SECONDARY.map(([to, label]) => (
            <NavLink key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className={`page ${running && run ? "refreshing" : ""}`}>
        {error ? (
          <div className="callout bad">Couldn't load data: {error}</div>
        ) : !run ? (
          <p className="muted">Crunching 25 years of games…</p>
        ) : (
          <Routes>
            <Route path="/" element={<WeekPage />} />
            <Route path="/rankings" element={<RankingsPage />} />
            <Route path="/matchup" element={<MatchupPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/team/:abbr" element={<TeamPage />} />
            <Route path="/lab" element={<LabPage />} />
            <Route path="/how" element={<HowPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        )}
      </main>
      <footer className="footer muted small">
        Scores, closing lines and coaches from{" "}
        <a href="https://github.com/nflverse/nfldata">nflverse</a>. Sportsbook odds from{" "}
        <a href="https://the-odds-api.com">The Odds API</a> when configured. A research project and paper-trade record, not betting advice.
      </footer>
    </>
  );
}

export function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </AppProvider>
  );
}
