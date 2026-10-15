// Auto-generated from schema. Regenerate with: npm run types
// Or keep this file and update manually when schema changes.

export type OrderStatus =
  | 'new'
  | 'review'
  | 'confirmed'
  | 'assembling'
  | 'ready'
  | 'shipped'
  | 'received'
  | 'cancelled'
  | 'rejected'

export type DeliveryType = 'office' | 'pvz' | 'pickup' | 'courier'

export type MovementType =
  | 'income'
  | 'reserve'
  | 'unreserve'
  | 'write_off'
  | 'return'
  | 'adjustment'

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new:        'Новый заказ',
  review:     'На проверке',
  confirmed:  'Подтвержден',
  assembling: 'Собирается',
  ready:      'Готов к выдаче',
  shipped:    'Отправлен',
  received:   'Выдали',
  cancelled:  'Отменен',
  rejected:   'Отклонен',
}

export const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  office:  'В офис',
  pvz:     'ПВЗ / Филиал',
  pickup:  'Самовывоз',
  courier: 'Курьер',
}

type Rel<
  FKName extends string,
  Cols extends string[],
  RefTable extends string,
  RefCols extends string[],
  OneToOne extends boolean = false,
> = {
  foreignKeyName: FKName
  columns: Cols
  isOneToOne: OneToOne
  referencedRelation: RefTable
  referencedColumns: RefCols
}

export type Database = {
  public: {
    Tables: {
      pickup_offices: {
        Row: { id: string; name: string; address: string; is_active: boolean; sort: number; deleted_at:string|null }
        Insert: { id?: string; name: string; address?: string; is_active?: boolean; sort?: number; deleted_at?:string|null }
        Update: Partial<Database['public']['Tables']['pickup_offices']['Insert']>
        Relationships: never[]
      }
      fulfillment_choices: {
        Row: { id: string; name: string; mode: 'remote_shipping'|'remote_visit'|'placeholder'; is_active: boolean; sort: number; deleted_at:string|null }
        Insert: { id?: string; name: string; mode: 'remote_shipping'|'remote_visit'|'placeholder'; is_active?: boolean; sort?: number; deleted_at?:string|null }
        Update: Partial<Database['public']['Tables']['fulfillment_choices']['Insert']>
        Relationships: never[]
      }
      order_tasks: {
        Row: { id: string; order_id: string; due_on: string; reserve_until: string; contacted_at: string | null; contacted_by: string | null; closed_at: string | null; created_at: string }
        Insert: never
        Update: never
        Relationships: [Rel<'order_tasks_order_id_fkey', ['order_id'], 'orders', ['id']>]
      }
      order_events: {
        Row: { id: string; order_id: string; actor_id: string | null; action: string; data: Record<string, unknown>; created_at: string }
        Insert: never
        Update: never
        Relationships: never[]
      }
      employees: {
        Row: {
          id:          string
          full_name:   string
          email:       string
          phone:       string | null
          department:  string | null
          business_unit: string | null
          position:    string | null
          hired_at:    string | null
          city:        string | null
          office:      string | null
          is_admin:    boolean
          is_active:   boolean
          password_set_at: string | null
          created_at:  string
        }
        Insert: {
          id?:         string
          full_name:   string
          email:       string
          phone?:      string | null
          department?: string | null
          business_unit?: string | null
          position?:   string | null
          hired_at?:    string | null
          city?:       string | null
          office?:     string | null
          is_admin?:   boolean
          is_active?:  boolean
          password_set_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['employees']['Insert']>
        Relationships: never[]
      }
      employee_invitations: {
        Row: { store_scope: string; id: string; employee_directory_id: string; channel: string; token_hash: string; code_hash: string; expires_at: string; created_at: string; created_by: string | null; claimed_at: string | null; claimed_by: string | null; revoked_at: string | null; failed_attempts: number; delivery_status: string; delivery_started_at: string | null; delivery_error: string | null }
        Insert: never
        Update: { delivery_status?: string; delivery_started_at?: string | null; delivery_error?: string | null }
        Relationships: never[]
      }
      employee_directory: {
        Row: {
          store_scope: string
          legal_entity: string | null
          id:            string
          email:         string
          full_name:     string
          business_unit: string | null
          position:      string | null
          invitation_required: boolean
          invitation_user_id: string | null
          invitation_one_order: boolean
          access_mode: string
          access_expires_at: string | null
          access_used_at: string | null
          external_id:   string | null
          hired_at:      string | null
          is_active:     boolean
          created_at:    string
          updated_at:    string
        }
        Insert: {
          store_scope?: string
          legal_entity?: string | null
          id?:            string
          email:          string
          full_name:      string
          business_unit?: string | null
          position?:      string | null
          invitation_required?: boolean
          invitation_user_id?: string | null
          invitation_one_order?: boolean
          access_mode?: string
          access_expires_at?: string | null
          access_used_at?: string | null
          external_id?:   string | null
          hired_at?:      string | null
          is_active?:     boolean
        }
        Update: Partial<Database['public']['Tables']['employee_directory']['Insert']>
        Relationships: never[]
      }
      employee_audit_log: {
        Row: {
          id:                    string
          employee_directory_id: string | null
          actor_id:              string | null
          action:                string
          changed_fields:        Record<string, unknown>
          created_at:            string
        }
        Insert: {
          id?:                    string
          employee_directory_id?: string | null
          actor_id?:              string | null
          action:                 string
          changed_fields?:        Record<string, unknown>
        }
        Update: never
        Relationships: [
          Rel<'employee_audit_log_employee_directory_id_fkey', ['employee_directory_id'], 'employee_directory', ['id']>,
          Rel<'employee_audit_log_actor_id_fkey', ['actor_id'], 'employees', ['id']>,
        ]
      }
      categories: {
        Row:    { id: string; name: string; sort: number }
        Insert: { id?: string; name: string; sort?: number }
        Update: Partial<Database['public']['Tables']['categories']['Insert']>
        Relationships: never[]
      }
      products: {
        Row: {
          id:          string
          placement:   string
          name:        string
          description: string | null
          material:    string | null
          category_id: string | null
          image_url:   string | null
          images:      string[]
          is_active:   boolean
          created_at:  string
          updated_at:  string
        }
        Insert: {
          id?:          string
          placement?:   string
          name:         string
          description?: string | null
          material?:    string | null
          category_id?: string | null
          image_url?:   string | null
          images?:      string[]
          is_active?:   boolean
        }
        Update: Partial<Database['public']['Tables']['products']['Insert']>
        Relationships: [
          Rel<'products_category_id_fkey', ['category_id'], 'categories', ['id']>,
        ]
      }
      product_variants: {
        Row: {
          id:           string
          product_id:   string
          size:         string | null
          color:        string | null
          sku:          string | null
          total_qty:    number
          reserved_qty: number
          is_active:    boolean
          created_at:   string
          updated_at:   string
        }
        Insert: {
          id?:           string
          product_id:    string
          size?:         string | null
          color?:        string | null
          sku?:          string | null
          total_qty?:    number
          reserved_qty?: number
          is_active?:    boolean
        }
        Update: Partial<Database['public']['Tables']['product_variants']['Insert']>
        Relationships: [
          Rel<'product_variants_product_id_fkey', ['product_id'], 'products', ['id']>,
        ]
      }
      product_limits: {
        Row: {
          id:             string
          product_id:     string
          limit_per_emp:  number
          period:         string
          department:     string | null
          created_at:     string
        }
        Insert: {
          id?:             string
          product_id:      string
          limit_per_emp?:  number
          period?:         string
          department?:     string | null
        }
        Update: Partial<Database['public']['Tables']['product_limits']['Insert']>
        Relationships: [
          Rel<'product_limits_product_id_fkey', ['product_id'], 'products', ['id']>,
        ]
      }
      carts: {
        Row: {
          id:          string
          employee_id: string
          status:      string
          created_at:  string
          updated_at:  string
        }
        Insert: { id?: string; employee_id: string; status?: string }
        Update: Partial<Database['public']['Tables']['carts']['Insert']>
        Relationships: [
          Rel<'carts_employee_id_fkey', ['employee_id'], 'employees', ['id']>,
        ]
      }
      cart_items: {
        Row: {
          id:         string
          cart_id:    string
          product_id: string
          variant_id: string
          qty:        number
          created_at: string
        }
        Insert: {
          id?:        string
          cart_id:    string
          product_id: string
          variant_id: string
          qty?:       number
        }
        Update: Partial<Database['public']['Tables']['cart_items']['Insert']>
        Relationships: [
          Rel<'cart_items_cart_id_fkey',    ['cart_id'],    'carts',            ['id']>,
          Rel<'cart_items_product_id_fkey', ['product_id'], 'products',         ['id']>,
          Rel<'cart_items_variant_id_fkey', ['variant_id'], 'product_variants', ['id']>,
        ]
      }
      orders: {
        Row: {
          order_scope: string
          fulfillment_mode: string | null
          fulfillment_choice_id: string | null
          fulfillment_choice_name: string | null
          legal_entity: string | null
          pickup_office_id: string | null
          pickup_office_name: string | null
          pickup_office_address: string | null
          visit_from: string | null
          visit_until: string | null

          pickup_code: string | null
          version: number
          received_by: string | null
          received_by_name: string | null
          remote_contact_name: string | null
          id:               string
          order_number:     string
          employee_id:      string
          status:           OrderStatus
          delivery_type:    DeliveryType
          delivery_address: string | null
          full_name:        string | null
          phone:            string | null
          email:            string | null
          city:             string | null
          department:       string | null
          comment:          string | null
          admin_comment:    string | null
          tracking_number:  string | null
          assigned_to:      string | null
          shipping_places_count: number | null
          shipping_weight_kg: number | null
          shipping_package_type: string | null
          shipping_printed_at: string | null
          shipping_printed_by: string | null
          storage_location: string | null
          pickup_status:    string
          handed_to:        string | null
          is_remote:        boolean
          country:          string | null
          created_at:       string
          confirmed_at:     string | null
          shipped_at:       string | null
          received_at:      string | null
          cancelled_at:     string | null
        }
        Insert: {
          order_scope?: string
          fulfillment_mode?: string | null
          fulfillment_choice_id?: string | null
          fulfillment_choice_name?: string | null
          legal_entity?: string | null
          pickup_office_id?: string | null
          pickup_office_name?: string | null
          pickup_office_address?: string | null
          visit_from?: string | null
          visit_until?: string | null

          id?:               string
          employee_id:       string
          is_remote?:        boolean
          country?:          string | null
          status?:           OrderStatus
          delivery_type?:    DeliveryType
          delivery_address?: string | null
          full_name?:        string | null
          phone?:            string | null
          email?:            string | null
          city?:             string | null
          department?:       string | null
          comment?:          string | null
          shipping_places_count?: number | null
          shipping_weight_kg?: number | null
          shipping_package_type?: string | null
        }
        Update: Partial<Database['public']['Tables']['orders']['Insert']> & {
          status?:           OrderStatus
          admin_comment?:    string | null
          tracking_number?:  string | null
          assigned_to?:      string | null
          storage_location?: string | null
          pickup_status?:    string
          handed_to?:        string | null
          is_remote?:        boolean
          country?:          string | null
          shipping_places_count?: number | null
          shipping_weight_kg?: number | null
          shipping_package_type?: string | null
          shipping_printed_at?: string | null
          shipping_printed_by?: string | null
          confirmed_at?:     string | null
          shipped_at?:       string | null
          received_at?:      string | null
          cancelled_at?:     string | null
        }
        Relationships: [
          Rel<'orders_employee_id_fkey', ['employee_id'], 'employees', ['id']>,
        ]
      }
      merch_settings: {
        Row: {
          catalog_rules: string
          welcome_rules: string
          shipping_message: string
          visit_message: string
          welcome_pickup_message: string
          welcome_shipping_message: string
          welcome_visit_message: string

          pickup_message: string

          id:               number
          handout_deadline: string | null
          handout_place:    string | null
          handout_note:     string | null
          updated_at:       string
        }
        Insert: {
          catalog_rules?: string
          welcome_rules?: string
          shipping_message?: string
          visit_message?: string
          welcome_pickup_message?: string
          welcome_shipping_message?: string
          welcome_visit_message?: string

          pickup_message?: string

          id?:               number
          handout_deadline?: string | null
          handout_place?:    string | null
          handout_note?:     string | null
          updated_at?:       string
        }
        Update: Partial<Database['public']['Tables']['merch_settings']['Insert']>
        Relationships: never[]
      }
      order_items: {
        Row: {
          id:           string
          order_id:     string
          product_id:   string
          variant_id:   string
          product_name: string
          size:         string | null
          color:        string | null
          sku:          string | null
          qty:          number
          created_at:   string
        }
        Insert: {
          id?:           string
          order_id:      string
          product_id:    string
          variant_id:    string
          product_name:  string
          size?:         string | null
          color?:        string | null
          sku?:          string | null
          qty:           number
        }
        Update: never
        Relationships: [
          Rel<'order_items_order_id_fkey',   ['order_id'],   'orders',           ['id']>,
          Rel<'order_items_product_id_fkey', ['product_id'], 'products',         ['id']>,
          Rel<'order_items_variant_id_fkey', ['variant_id'], 'product_variants', ['id']>,
        ]
      }
      stock_movements: {
        Row: {
          id:             string
          variant_id:     string
          movement_type:  MovementType
          qty:            number
          order_id:       string | null
          comment:        string | null
          created_by:     string | null
          created_at:     string
        }
        Insert: {
          id?:             string
          variant_id:      string
          movement_type:   MovementType
          qty:             number
          order_id?:       string | null
          comment?:        string | null
          created_by?:     string | null
        }
        Update: never
        Relationships: [
          Rel<'stock_movements_variant_id_fkey',  ['variant_id'],  'product_variants', ['id']>,
          Rel<'stock_movements_order_id_fkey',    ['order_id'],    'orders',           ['id']>,
          Rel<'stock_movements_created_by_fkey',  ['created_by'],  'employees',        ['id']>,
        ]
      }
    }
    Views: {
      product_variants_available: {
        Row: Database['public']['Tables']['product_variants']['Row'] & {
          available_qty: number
        }
        Relationships: [
          Rel<'product_variants_product_id_fkey', ['product_id'], 'products', ['id']>,
        ]
      }
    }
    Functions: {
      admin_create_invitation: { Args: { p_id: string; p_employee_id: string; p_token_hash: string; p_code_hash: string; p_channel: string; p_scope?: string }; Returns: { id: string; expires_at: string; email: string; full_name: string; external_id: string | null } }
      check_invitation_code: { Args: { p_token_hash: string; p_code_hash: string }; Returns: { ok: boolean; id?: string } }
      claim_invitation: { Args: { p_id: string; p_user_id: string; p_code_hash: string | null }; Returns: { ok: boolean; next: string } }
      has_system_access: { Args: Record<string, never>; Returns: boolean }
      admin_import_employees: {
        Args: { p_rows: { email: string; full_name: string; external_id: string | null }[] }
        Returns: { added: number; skipped: number; employee_ids: string[] }
      }
      admin_create_product: {
        Args: { p_name: string; p_description: string | null; p_image_url: string | null; p_placement: string; p_variants: { size: string; color: string; qty: number }[] }
        Returns: { id: string }
      }
      admin_issue_order: {
        Args: { p_code: string }
        Returns: { order_id: string; order_number: string; already_issued: boolean; received_at: string; issued_by_name: string | null; recipient: string | null }
      }
      admin_save_order: {
        Args: { p_order_id: string; p_status: OrderStatus; p_expected_version: number; p_admin_comment: string | null; p_tracking_number: string | null; p_storage_location: string | null; p_assigned_to: string | null }
        Returns: unknown
      }
      admin_replace_order_items: {
        Args: { p_order_id: string; p_items: { variant_id: string; qty: number }[]; p_expected_version: number }
        Returns: unknown
      }
      my_store_scope: { Args: Record<string, never>; Returns: 'catalog' | 'welcome' | null }
      has_shop_access: { Args: {p_scope:string}; Returns:boolean }
      my_checkout_identity: { Args: Record<string, never>; Returns: { full_name: string; legal_entity: string | null } | null }
      admin_contact_visit: { Args: { p_id: string }; Returns: undefined }
      create_merch_order_v2: { Args: { p_items: unknown; p_mode: string; p_office_id: string | null; p_phone: string; p_country: string | null; p_city: string | null; p_comment: string | null; p_visit_from: string | null; p_visit_until: string | null }; Returns: { id: string; order_number: string; pickup_code: string | null; fulfillment_mode: string; pickup_message: string; order_scope:string } }
      create_merch_order_v3: { Args: { p_choice_id: string | null; p_items: unknown; p_mode: string; p_office_id: string | null; p_phone: string; p_country: string | null; p_city: string | null; p_comment: string | null; p_visit_from: string | null; p_visit_until: string | null }; Returns: { id: string; order_number: string; pickup_code: string | null; fulfillment_mode: string; pickup_message: string; order_scope:string } }
      create_merch_order: {
        Args: {
          p_items:            { variant_id: string; qty: number }[]
          p_delivery_type:    DeliveryType
          p_delivery_address: string | null
          p_phone:            string | null
          p_comment:          string | null
          p_is_remote:        boolean
          p_country:          string | null
        }
        Returns: unknown
      }
      get_employee_merch_access: {
        Args: {
          p_email: string
        }
        Returns: Array<{
          is_allowed: boolean
          reason: string
          hired_at: string | null
          months_worked: number | null
        }>
      }
      admin_update_order: {
        Args: {
          p_order_id:        string
          p_status:          OrderStatus
          p_admin_comment:   string | null
          p_tracking_number: string | null
        }
        Returns: unknown
      }
      admin_set_order_handout: {
        Args: {
          p_order_id:         string
          p_storage_location: string | null
          p_pickup_status:    string | null
          p_handed_to:        string | null
        }
        Returns: unknown
      }
      update_my_profile: {
        Args: {
          p_full_name:  string
          p_phone:      string | null
          p_department: string | null
          p_position:   string | null
          p_city:       string | null
          p_office:     string | null
        }
        Returns: unknown
      }
      mark_password_set: {
        Args: Record<PropertyKey, never>
        Returns: void
      }
    }
    Enums: {
      order_status:  OrderStatus
      delivery_type: DeliveryType
      movement_type: MovementType
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience row types
export type Employee       = Database['public']['Tables']['employees']['Row']
export type Product        = Database['public']['Tables']['products']['Row']
export type ProductVariant = Database['public']['Tables']['product_variants']['Row']
export type ProductVariantAvailable = Database['public']['Views']['product_variants_available']['Row']
export type Order          = Database['public']['Tables']['orders']['Row']
export type OrderItem      = Database['public']['Tables']['order_items']['Row']
export type CartItem       = Database['public']['Tables']['cart_items']['Row']
export type StockMovement  = Database['public']['Tables']['stock_movements']['Row']

// Useful joined types
export type ProductWithVariants = Product & {
  category:  { name: string } | null
  variants:  ProductVariantAvailable[]
}

export type OrderWithItems = Order & {
  employee:    Pick<Employee, 'full_name' | 'email' | 'department'>
  order_items: (OrderItem & { variant: Pick<ProductVariant, 'size' | 'color'> })[]
}
