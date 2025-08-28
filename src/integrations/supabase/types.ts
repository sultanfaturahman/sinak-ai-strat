export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      ai_summaries: {
        Row: {
          context_snapshot: Json | null
          created_at: string | null
          id: string
          model: string
          result_json: Json | null
          type: Database["public"]["Enums"]["ai_summary_type"]
          user_id: string
          version: number | null
        }
        Insert: {
          context_snapshot?: Json | null
          created_at?: string | null
          id?: string
          model: string
          result_json?: Json | null
          type: Database["public"]["Enums"]["ai_summary_type"]
          user_id: string
          version?: number | null
        }
        Update: {
          context_snapshot?: Json | null
          created_at?: string | null
          id?: string
          model?: string
          result_json?: Json | null
          type?: Database["public"]["Enums"]["ai_summary_type"]
          user_id?: string
          version?: number | null
        }
        Relationships: []
      }
      import_runs: {
        Row: {
          created_at: string | null
          error: string | null
          filename: string
          finished_at: string | null
          id: string
          status: Database["public"]["Enums"]["import_status"] | null
          total_imported: number | null
          total_rows: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          filename: string
          finished_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["import_status"] | null
          total_imported?: number | null
          total_rows?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          error?: string | null
          filename?: string
          finished_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["import_status"] | null
          total_imported?: number | null
          total_rows?: number | null
          user_id?: string
        }
        Relationships: []
      }
      monthly_metrics: {
        Row: {
          cogs_rp: number | null
          gross_margin: number | null
          gross_profit_rp: number | null
          mom_sales_pct: number | null
          month_start: string
          net_margin: number | null
          net_profit_rp: number | null
          opex_rp: number | null
          sales_rp: number | null
          top_expenses: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cogs_rp?: number | null
          gross_margin?: number | null
          gross_profit_rp?: number | null
          mom_sales_pct?: number | null
          month_start: string
          net_margin?: number | null
          net_profit_rp?: number | null
          opex_rp?: number | null
          sales_rp?: number | null
          top_expenses?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cogs_rp?: number | null
          gross_margin?: number | null
          gross_profit_rp?: number | null
          mom_sales_pct?: number | null
          month_start?: string
          net_margin?: number | null
          net_profit_rp?: number | null
          opex_rp?: number | null
          sales_rp?: number | null
          top_expenses?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          city: string | null
          created_at: string | null
          display_name: string | null
          last_recomputed_at: string | null
          last12m_turnover_rp: number | null
          umkm_level: Database["public"]["Enums"]["umkm_level"] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          display_name?: string | null
          last_recomputed_at?: string | null
          last12m_turnover_rp?: number | null
          umkm_level?: Database["public"]["Enums"]["umkm_level"] | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          city?: string | null
          created_at?: string | null
          display_name?: string | null
          last_recomputed_at?: string | null
          last12m_turnover_rp?: number | null
          umkm_level?: Database["public"]["Enums"]["umkm_level"] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_rp: number
          category: string
          created_at: string | null
          date_ts: string
          id: string
          kind: Database["public"]["Enums"]["txn_kind"]
          notes: string | null
          uniq_hash: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount_rp: number
          category: string
          created_at?: string | null
          date_ts: string
          id?: string
          kind: Database["public"]["Enums"]["txn_kind"]
          notes?: string | null
          uniq_hash?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount_rp?: number
          category?: string
          created_at?: string | null
          date_ts?: string
          id?: string
          kind?: Database["public"]["Enums"]["txn_kind"]
          notes?: string | null
          uniq_hash?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      classify_umkm_by_turnover: {
        Args: { turnover_rp: number }
        Returns: Database["public"]["Enums"]["umkm_level"]
      }
      generate_transaction_hash: {
        Args: {
          p_amount_rp: number
          p_category: string
          p_date_ts: string
          p_kind: Database["public"]["Enums"]["txn_kind"]
          p_notes: string
          p_user_id: string
        }
        Returns: string
      }
      month_start_from_ts: {
        Args: { ts: string }
        Returns: string
      }
      recompute_last12m: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      recompute_month_for_user: {
        Args: { p_month_start: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      ai_summary_type:
        | "strategy_plan"
        | "cashflow_forecast"
        | "pricing_review"
        | "marketing_plan"
      import_status: "running" | "succeeded" | "failed"
      txn_kind: "income" | "cogs" | "expense"
      umkm_level: "mikro" | "kecil" | "menengah" | "besar"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_summary_type: [
        "strategy_plan",
        "cashflow_forecast",
        "pricing_review",
        "marketing_plan",
      ],
      import_status: ["running", "succeeded", "failed"],
      txn_kind: ["income", "cogs", "expense"],
      umkm_level: ["mikro", "kecil", "menengah", "besar"],
    },
  },
} as const
