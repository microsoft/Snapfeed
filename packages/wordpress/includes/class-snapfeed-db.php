<?php
/**
 * Snapfeed database layer.
 *
 * Creates and manages the wp_snapfeed_events table using WordPress $wpdb.
 * Schema mirrors the SQLite version but uses MySQL types.
 */

defined('ABSPATH') || exit;

class Snapfeed_DB {

    /**
     * Get the full table name with WP prefix.
     */
    public static function table_name(): string {
        global $wpdb;
        return $wpdb->prefix . 'snapfeed_events';
    }

    /**
     * Create the events table. Called on plugin activation.
     */
    public static function create_tables(): void {
        global $wpdb;
        $table   = self::table_name();
        $charset = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE {$table} (
            id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            session_id    VARCHAR(64)  NOT NULL,
            seq           INT UNSIGNED NOT NULL,
            ts            DATETIME     NOT NULL,
            event_type    VARCHAR(32)  NOT NULL,
            page          VARCHAR(512) DEFAULT NULL,
            target        TEXT         DEFAULT NULL,
            detail_json   LONGTEXT     DEFAULT NULL,
            screenshot    LONGTEXT     DEFAULT NULL,
            created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
            resolved_at   DATETIME     DEFAULT NULL,
            resolved_by   BIGINT UNSIGNED DEFAULT NULL,
            resolved_note TEXT         DEFAULT NULL,
            PRIMARY KEY (id),
            INDEX idx_session (session_id, seq),
            INDEX idx_type (event_type),
            INDEX idx_created (created_at)
        ) {$charset};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);
    }

    /**
     * Insert a batch of telemetry events.
     *
     * @param array $events Array of event objects from the client.
     * @return int Number of rows inserted.
     */
    public static function insert_events(array $events): int {
        global $wpdb;
        $table   = self::table_name();
        $inserted = 0;

        foreach ($events as $event) {
            $result = $wpdb->insert($table, [
                'session_id'  => sanitize_text_field($event['session_id'] ?? ''),
                'seq'         => absint($event['seq'] ?? 0),
                'ts'          => sanitize_text_field($event['ts'] ?? current_time('mysql', true)),
                'event_type'  => sanitize_text_field($event['event_type'] ?? ''),
                'page'        => isset($event['page']) ? sanitize_text_field($event['page']) : null,
                'target'      => isset($event['target']) ? sanitize_text_field($event['target']) : null,
                'detail_json' => isset($event['detail']) ? wp_json_encode($event['detail']) : null,
                'screenshot'  => $event['screenshot'] ?? null,
            ], ['%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s']);

            if ($result !== false) {
                $inserted++;
            }
        }

        return $inserted;
    }

    /**
     * Query events with optional filters.
     */
    public static function get_events(array $args = []): array {
        global $wpdb;
        $table = self::table_name();

        $where  = [];
        $values = [];

        if (!empty($args['session_id'])) {
            $where[]  = 'session_id = %s';
            $values[] = $args['session_id'];
        }
        if (!empty($args['event_type'])) {
            $where[]  = 'event_type = %s';
            $values[] = $args['event_type'];
        }

        $limit = min(absint($args['limit'] ?? 200), 1000);

        $where_sql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $values[]  = $limit;

        $sql = "SELECT id, session_id, seq, ts, event_type, page, target, detail_json
                FROM {$table} {$where_sql}
                ORDER BY id DESC LIMIT %d";

        if ($values) {
            $sql = $wpdb->prepare($sql, ...$values);
        }

        return $wpdb->get_results($sql, ARRAY_A) ?: [];
    }

    /**
     * Get session summaries with aggregated stats.
     */
    public static function get_sessions(int $limit = 20): array {
        global $wpdb;
        $table = self::table_name();
        $limit = min($limit, 100);

        $sql = $wpdb->prepare("
            SELECT session_id,
                   MIN(ts)    AS first_event,
                   MAX(ts)    AS last_event,
                   COUNT(*)   AS event_count,
                   SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) AS error_count,
                   SUM(CASE WHEN event_type = 'feedback' THEN 1 ELSE 0 END) AS feedback_count
            FROM {$table}
            GROUP BY session_id
            ORDER BY MAX(created_at) DESC
            LIMIT %d
        ", $limit);

        return $wpdb->get_results($sql, ARRAY_A) ?: [];
    }

    /**
     * Get a single event's screenshot data.
     */
    public static function get_screenshot(int $event_id): ?string {
        global $wpdb;
        $table = self::table_name();

        return $wpdb->get_var($wpdb->prepare(
            "SELECT screenshot FROM {$table} WHERE id = %d",
            $event_id
        ));
    }

    /**
     * Resolve a feedback event.
     */
    public static function resolve_event(int $event_id, int $user_id, string $note): bool {
        global $wpdb;
        $table = self::table_name();

        $result = $wpdb->update(
            $table,
            [
                'resolved_at'   => current_time('mysql', true),
                'resolved_by'   => $user_id,
                'resolved_note' => sanitize_textarea_field($note),
            ],
            ['id' => $event_id],
            ['%s', '%d', '%s'],
            ['%d']
        );

        return $result !== false;
    }

    /**
     * Schedule daily cleanup cron job.
     */
    public static function schedule_cleanup(): void {
        if (!wp_next_scheduled('snapfeed_daily_cleanup')) {
            wp_schedule_event(time(), 'daily', 'snapfeed_daily_cleanup');
        }
    }

    /**
     * Delete events older than the retention period.
     */
    public static function cleanup_old_events(): void {
        global $wpdb;
        $table = self::table_name();

        $settings  = get_option('snapfeed_settings', []);
        $retention = absint($settings['data_retention_days'] ?? 90);
        if ($retention < 1) return;

        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$table} WHERE created_at < DATE_SUB(NOW(), INTERVAL %d DAY)",
            $retention
        ));
    }
}
