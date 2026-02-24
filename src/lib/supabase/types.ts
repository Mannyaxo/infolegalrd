export type Database = {
  public: {
    Tables: {
      consultas_diarias: {
        Row: {
          id: string;
          user_id: string;
          fecha: string;
          cantidad: number;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          fecha: string;
          cantidad?: number;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          fecha?: string;
          cantidad?: number;
          created_at?: string | null;
        };
        Relationships: [];
      };
      faqs: {
        Row: { id: string; category: string; question: string; answer: string; created_at: string };
        Insert: { id?: string; category: string; question: string; answer: string; created_at?: string };
        Update: { category?: string; question?: string; answer?: string; created_at?: string };
        Relationships: [];
      };
      usuarios_premium: {
        Row: { id: string; user_id: string; stripe_subscription_id: string | null; activo: boolean; created_at: string };
        Insert: { id?: string; user_id: string; stripe_subscription_id?: string | null; activo?: boolean; created_at?: string };
        Update: { user_id?: string; stripe_subscription_id?: string | null; activo?: boolean; created_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
