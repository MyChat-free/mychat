import Link from "next/link";
import { ROLES } from "@/lib/roles";

export default function Home() {
  const roles = Object.values(ROLES);

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 32, fontWeight: 800 }}>Web Coach App — MVP</h1>
      <p style={{ marginTop: 10, fontSize: 16 }}>Выбери роль и начни диалог.</p>

      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        {roles.map((role) => (
          <Link
            key={role.id}
            href={role.path}
            style={{
              display: "block",
              padding: 16,
              borderRadius: 14,
              border: "1px solid #ddd",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>{role.title}</div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>{role.description}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}