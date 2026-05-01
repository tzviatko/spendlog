import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, key);

export interface ExpenseRow {
  id: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
  rate: number;
  payment: string;
  notes: string;
  usd_amount: number;
  created_at: string;
  user_id: string | null;
}
