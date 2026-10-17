import { Route, Routes } from 'react-router';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Results from './pages/Results.jsx';
import Session from './pages/Session.jsx';
import Watchlist from './pages/Watchlist.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="results" element={<Results />} />
        <Route path="watchlist" element={<Watchlist />} />
        <Route path="session" element={<Session />} />
        <Route path="*" element={<p className="text-slate-600">Page not found.</p>} />
      </Route>
    </Routes>
  );
}
