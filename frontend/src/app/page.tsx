// Server Component — no 'use client', fixes "React Client Manifest" Turbopack bug
import HomeClient from './HomeClient';

export default function Home() {
  return <HomeClient />;
}
