export type Database = {
  public: {
    Tables: {
      consultas_diarias: {
        Row: {
          id: string;
          user_id: string;
          fecha: string;
          cantidad: number;
          created_at?: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          fecha: string;
          cantidad?: number;
          created_at?: string;
        };
        Update: {
          cantidad?: number;
          [key: string]: any;
        };
      };
      faqs: {
        Row: { id: string; category: string; question: string; answer: string; created_at: string };
        Insert: { id?: string; category: string; question: string; answer: string; created_at?: string };
        Update: { category?: string; question?: string; answer?: string };
      };
      usuarios_premium: {
        Row: { id: string; user_id: string; stripe_subscription_id: string | null; activo: boolean };
        Insert: { id?: string; user_id: string; stripe_subscription_id?: string | null; activo?: boolean };
        Update: { stripe_subscription_id?: string | null; activo?: boolean };
      };
    };
  };
};
