"use client";

import { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import LoginForm from "./LoginForm";

interface AuthGuardProps {
  children: ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const { session, loading } = useAuth();

  // Si no hay sesión, mostrar LoginForm
  if (!session) {
    return <LoginForm onSuccess={() => {}} />;
  }

  // Con sesión activa, mostrar el panel principal de BraxPanel
  return <>{children}</>;
}
