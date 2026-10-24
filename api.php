<?php
/**
 * Backend API for Shrine Survey (استبيان قسم الشؤون الدينية - العتبة الحسينية المقدسة)
 * High-Reliability Dual Storage Engine (SQLite Database + JSON File Persistence)
 * Supports all PHP Cloud Environments (cPanel, Hostinger, Apache, Nginx, LiteSpeed, VPS)
 */

// 1. Error handling: Prevent notices/warnings from corrupting JSON output
error_reporting(E_ALL);
ini_set('display_errors', '0');

// 2. Set permissive CORS, Anti-Cache, and UTF-8 JSON Headers
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma, Expires");
header("Access-Control-Max-Age: 86400");
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0, post-check=0, pre-check=0");
header("Pragma: no-cache");
header("Expires: Thu, 01 Jan 1970 00:00:00 GMT");

// Handle OPTIONS preflight request immediately
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// 3. File and Database Paths
$dataFile   = __DIR__ . '/responses.json';
$adminsFile = __DIR__ . '/admins.json';
$dbFile     = __DIR__ . '/shrine_data.db';

// Ensure data file exists with proper permissions
if (!file_exists($dataFile)) {
    @file_put_contents($dataFile, json_encode([], JSON_UNESCAPED_UNICODE), LOCK_EX);
    @chmod($dataFile, 0666);
} else {
    if (!is_writable($dataFile)) {
        @chmod($dataFile, 0666);
    }
}

// Ensure admins file exists with proper permissions
function getDefaultAdmins() {
    return [
        [
            'username'  => 'admin',
            'password'  => 'admin123',
            'fullName'  => 'المشرف العام - قسم الشؤون الدينية',
            'role'      => 'ADMIN',
            'province'  => 'كربلاء المقدسة',
            'createdAt' => '2026-01-01 00:00:00'
        ]
    ];
}

if (!file_exists($adminsFile)) {
    @file_put_contents($adminsFile, json_encode(getDefaultAdmins(), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
    @chmod($adminsFile, 0666);
} else {
    if (!is_writable($adminsFile)) {
        @chmod($adminsFile, 0666);
    }
}

// ================= STORAGE ENGINES =================

/**
 * Initialize SQLite Database connection
 */
function getDatabase($dbFile) {
    if (!extension_loaded('pdo') || !in_array('sqlite', PDO::getAvailableDrivers())) {
        return null;
    }
    try {
        $pdo = new PDO("sqlite:" . $dbFile, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5
        ]);
        try {
            $pdo->exec("PRAGMA journal_mode = WAL;");
        } catch (Exception $walEx) {
            try {
                $pdo->exec("PRAGMA journal_mode = DELETE;");
            } catch (Exception $delEx) {}
        }
        $pdo->exec("CREATE TABLE IF NOT EXISTS responses (
            id TEXT PRIMARY KEY,
            timestamp TEXT,
            participant_name TEXT,
            province TEXT,
            data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );");
        $pdo->exec("CREATE TABLE IF NOT EXISTS admins (
            username TEXT PRIMARY KEY,
            password TEXT,
            full_name TEXT,
            role TEXT,
            province TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );");
        @chmod($dbFile, 0666);
        return $pdo;
    } catch (Exception $e) {
        return null;
    }
}

$pdo = getDatabase($dbFile);

/**
 * Safe JSON file writer with multi-tier fallbacks
 */
function writeJsonFileSafely($filePath, $data) {
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) {
        return false;
    }

    if (file_exists($filePath)) {
        @chmod($filePath, 0666);
    }

    // Strategy 1: Try with LOCK_EX
    $res = @file_put_contents($filePath, $json, LOCK_EX);
    if ($res !== false) {
        @chmod($filePath, 0666);
        return true;
    }

    // Strategy 2: Try without LOCK_EX (essential for NFS, CloudLinux, Docker mounts)
    $res = @file_put_contents($filePath, $json);
    if ($res !== false) {
        @chmod($filePath, 0666);
        return true;
    }

    // Strategy 3: Atomic temp file and rename
    $temp = dirname($filePath) . '/tmp_' . bin2hex(random_bytes(4)) . '.json';
    if (@file_put_contents($temp, $json) !== false) {
        @chmod($temp, 0666);
        if (@rename($temp, $filePath)) {
            @chmod($filePath, 0666);
            return true;
        }
        @unlink($temp);
    }

    return false;
}

/**
 * Read all responses from Dual Engine (SQLite + JSON fallback)
 */
function getAllResponses($pdo, $dataFile) {
    $items = [];

    // 1. Try reading from SQLite
    if ($pdo !== null) {
        try {
            $stmt = $pdo->query("SELECT data FROM responses ORDER BY created_at DESC");
            while ($row = $stmt->fetch()) {
                $decoded = json_decode($row['data'], true);
                if (is_array($decoded)) {
                    $items[] = $decoded;
                }
            }
        } catch (Exception $e) {}
    }

    // 2. If SQLite is empty or unavailable, read from JSON file
    if (empty($items) && file_exists($dataFile)) {
        $raw = @file_get_contents($dataFile);
        if ($raw) {
            $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $items = $decoded;
                // Back-populate into SQLite
                if ($pdo !== null && !empty($items)) {
                    try {
                        $insertStmt = $pdo->prepare("INSERT OR REPLACE INTO responses (id, timestamp, participant_name, province, data) VALUES (:id, :timestamp, :name, :prov, :data)");
                        foreach ($items as $it) {
                            if (!empty($it['id'])) {
                                $insertStmt->execute([
                                    ':id' => $it['id'],
                                    ':timestamp' => $it['timestamp'] ?? date('c'),
                                    ':name' => $it['participantName'] ?? '',
                                    ':prov' => $it['province'] ?? '',
                                    ':data' => json_encode($it, JSON_UNESCAPED_UNICODE)
                                ]);
                            }
                        }
                    } catch (Exception $e) {}
                }
            }
        }
    }

    return is_array($items) ? $items : [];
}

/**
 * Save single response to both SQLite and JSON
 */
function saveSingleResponse($pdo, $dataFile, $newResponse) {
    $id = $newResponse['id'] ?? ('EST-' . mt_rand(100000, 999999));
    $newResponse['id'] = $id;
    $timestamp = $newResponse['timestamp'] ?? date('c');
    $name = $newResponse['participantName'] ?? '';
    $province = $newResponse['province'] ?? '';
    $jsonStr = json_encode($newResponse, JSON_UNESCAPED_UNICODE);

    $sqliteSaved = false;
    if ($pdo !== null) {
        try {
            $stmt = $pdo->prepare("INSERT OR REPLACE INTO responses (id, timestamp, participant_name, province, data) VALUES (:id, :ts, :name, :prov, :data)");
            $stmt->execute([
                ':id' => $id,
                ':ts' => $timestamp,
                ':name' => $name,
                ':prov' => $province,
                ':data' => $jsonStr
            ]);
            $sqliteSaved = true;
        } catch (Exception $e) {}
    }

    // Also update JSON file
    $all = getAllResponses($pdo, $dataFile);
    $existsIndex = -1;
    foreach ($all as $idx => $item) {
        if (isset($item['id']) && $item['id'] === $id) {
            $existsIndex = $idx;
            break;
        }
    }
    if ($existsIndex >= 0) {
        $all[$existsIndex] = $newResponse;
    } else {
        array_unshift($all, $newResponse);
    }

    $jsonSaved = writeJsonFileSafely($dataFile, $all);

    return ($sqliteSaved || $jsonSaved);
}

// ================= ADMIN ACCOUNTS ENGINES =================

/**
 * Read all supervisors from Dual Engine (SQLite + admins.json fallback)
 */
function getAllAdmins($pdo, $adminsFile) {
    $admins = [];

    // 1. Try reading from SQLite
    if ($pdo !== null) {
        try {
            $stmt = $pdo->query("SELECT * FROM admins ORDER BY created_at ASC");
            while ($row = $stmt->fetch()) {
                $admins[] = [
                    'username'  => $row['username'],
                    'password'  => $row['password'],
                    'fullName'  => $row['full_name'],
                    'role'      => $row['role'] ?? 'SUPERVISOR',
                    'province'  => $row['province'] ?? 'كربلاء المقدسة',
                    'createdAt' => $row['created_at'] ?? date('Y-m-d H:i:s')
                ];
            }
        } catch (Exception $e) {}
    }

    // 2. If SQLite is empty or unavailable, read from admins.json file
    if (empty($admins) && file_exists($adminsFile)) {
        $raw = @file_get_contents($adminsFile);
        if ($raw) {
            $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
            $decoded = json_decode($raw, true);
            if (is_array($decoded) && !empty($decoded)) {
                $admins = $decoded;
                // Back-populate into SQLite
                if ($pdo !== null) {
                    try {
                        $insertStmt = $pdo->prepare("INSERT OR REPLACE INTO admins (username, password, full_name, role, province, created_at) VALUES (:u, :p, :fn, :r, :prov, :ca)");
                        foreach ($admins as $adm) {
                            if (!empty($adm['username'])) {
                                $insertStmt->execute([
                                    ':u'    => $adm['username'],
                                    ':p'    => $adm['password'] ?? 'admin123',
                                    ':fn'   => $adm['fullName'] ?? 'مشرف النظام',
                                    ':r'    => $adm['role'] ?? 'ADMIN',
                                    ':prov' => $adm['province'] ?? 'كربلاء المقدسة',
                                    ':ca'   => $adm['createdAt'] ?? date('Y-m-d H:i:s')
                                ]);
                            }
                        }
                    } catch (Exception $e) {}
                }
            }
        }
    }

    // 3. Fallback: Seed default admin if still empty
    if (empty($admins)) {
        $admins = getDefaultAdmins();
        saveAdminsList($pdo, $adminsFile, $admins);
    }

    return $admins;
}

/**
 * Save full admins list to both SQLite and admins.json
 */
function saveAdminsList($pdo, $adminsFile, $admins) {
    if (empty($admins)) {
        $admins = getDefaultAdmins();
    }

    $sqliteSaved = false;
    if ($pdo !== null) {
        try {
            $pdo->beginTransaction();
            $pdo->exec("DELETE FROM admins");
            $stmt = $pdo->prepare("INSERT INTO admins (username, password, full_name, role, province, created_at) VALUES (:u, :p, :fn, :r, :prov, :ca)");
            foreach ($admins as $adm) {
                $stmt->execute([
                    ':u'    => $adm['username'],
                    ':p'    => $adm['password'] ?? '',
                    ':fn'   => $adm['fullName'] ?? '',
                    ':r'    => $adm['role'] ?? 'SUPERVISOR',
                    ':prov' => $adm['province'] ?? 'كربلاء المقدسة',
                    ':ca'   => $adm['createdAt'] ?? date('Y-m-d H:i:s')
                ]);
            }
            $pdo->commit();
            $sqliteSaved = true;
        } catch (Exception $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
        }
    }

    $jsonSaved = writeJsonFileSafely($adminsFile, $admins);
    return ($sqliteSaved || $jsonSaved);
}

/**
 * Authenticate supervisor username & password
 */
function authAdmin($pdo, $adminsFile, $username, $password) {
    $admins = getAllAdmins($pdo, $adminsFile);
    $u = trim(mb_strtolower($username, 'UTF-8'));
    foreach ($admins as $adm) {
        if (trim(mb_strtolower($adm['username'], 'UTF-8')) === $u) {
            if ($adm['password'] === $password) {
                return $adm;
            }
        }
    }
    return null;
}

// 4. Detect Request Action
$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? strtolower(trim($_GET['action'])) : '';

$requestUri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
if (strpos($requestUri, '/api/delete') !== false) {
    $action = 'delete';
} elseif (strpos($requestUri, '/api/update') !== false) {
    $action = 'update';
} elseif (strpos($requestUri, '/api/clear') !== false) {
    $action = 'clear';
} elseif (strpos($requestUri, '/api/health') !== false || strpos($requestUri, '/api/diagnostic') !== false) {
    $action = 'diagnostic';
} elseif (strpos($requestUri, '/api/repair') !== false) {
    $action = 'repair';
} elseif (strpos($requestUri, '/api/admin-auth') !== false || strpos($requestUri, '/api/admin-login') !== false) {
    $action = 'admin_login';
} elseif (strpos($requestUri, '/api/admins') !== false) {
    $action = ($method === 'POST') ? 'admin_create' : 'admins_get';
} elseif (strpos($requestUri, '/api/responses') !== false) {
    if ($method === 'GET') $action = 'get';
    if ($method === 'POST') $action = 'submit';
}

// Parse Raw Input Body (JSON)
$rawInput = file_get_contents('php://input');
$inputData = [];
if (!empty($rawInput)) {
    $rawInput = preg_replace('/^\xEF\xBB\xBF/', '', $rawInput);
    $decoded = json_decode($rawInput, true);
    if (is_array($decoded)) {
        $inputData = $decoded;
    }
}
if (empty($inputData) && !empty($_POST)) {
    $inputData = $_POST;
}

if (empty($action) && isset($inputData['action'])) {
    $action = strtolower(trim($inputData['action']));
}

if (empty($action) && $method === 'GET') {
    $action = 'get';
}

if (empty($action) && $method === 'POST') {
    if (isset($inputData['id']) || isset($inputData['ratings']) || isset($inputData['participantName'])) {
        $action = 'submit';
    } else {
        $action = 'get';
    }
}

// ================= ACTION DISPATCHER =================

switch ($action) {
    // ----------------------------------------------------
    // GET: Retrieve all survey responses
    // ----------------------------------------------------
    case 'get':
    case 'read':
    case 'list':
        $responses = getAllResponses($pdo, $dataFile);
        echo json_encode($responses, JSON_UNESCAPED_UNICODE);
        break;

    // ----------------------------------------------------
    // SUBMIT: Add new survey response
    // ----------------------------------------------------
    case 'submit':
    case 'save':
    case 'add':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $newResponse = !empty($inputData['response']) ? $inputData['response'] : $inputData;

        if (empty($newResponse) || (!isset($newResponse['id']) && !isset($newResponse['ratings']))) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "بيانات الاستبيان غير صالحة."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if (empty($newResponse['id'])) {
            $newResponse['id'] = 'EST-' . mt_rand(100000, 999999);
        }

        $saved = saveSingleResponse($pdo, $dataFile, $newResponse);

        if ($saved) {
            $currentCount = count(getAllResponses($pdo, $dataFile));
            echo json_encode([
                "status" => "success",
                "message" => "تم حفظ الاستبيان وتوثيقه بنجاح على السيرفر",
                "id" => $newResponse['id'],
                "count" => $currentCount,
                "storageEngine" => ($pdo !== null ? "SQLite + JSON" : "JSON")
            ], JSON_UNESCAPED_UNICODE);
        } else {
            http_response_code(500);
            echo json_encode([
                "status" => "error",
                "message" => "تعذر حفظ الاستبيان على السيرفر. يرجى مراجعة صلاحيات الكتابة."
            ], JSON_UNESCAPED_UNICODE);
        }
        break;

    // ----------------------------------------------------
    // UPDATE: Edit an existing response
    // ----------------------------------------------------
    case 'update':
    case 'edit':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $targetId = $inputData['id'] ?? ($_GET['id'] ?? '');
        if (empty($targetId)) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "رقم الاستبيان مطلوب للتعديل."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $all = getAllResponses($pdo, $dataFile);
        $found = false;
        $updatedItem = null;

        foreach ($all as $i => $item) {
            if (isset($item['id']) && $item['id'] === $targetId) {
                if (isset($inputData['participantName']) || isset($inputData['ratings'])) {
                    $all[$i] = array_merge($item, $inputData);
                } elseif (isset($inputData['item']) && is_array($inputData['item'])) {
                    $all[$i] = array_merge($item, $inputData['item']);
                }
                $updatedItem = $all[$i];
                $found = true;
                break;
            }
        }

        if (!$found) {
            http_response_code(404);
            echo json_encode(["status" => "error", "message" => "لم يتم العثور على الاستبيان المطلوب."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Update in SQLite
        if ($pdo !== null) {
            try {
                $stmt = $pdo->prepare("UPDATE responses SET participant_name = :name, province = :prov, data = :data WHERE id = :id");
                $stmt->execute([
                    ':id' => $targetId,
                    ':name' => $updatedItem['participantName'] ?? '',
                    ':prov' => $updatedItem['province'] ?? '',
                    ':data' => json_encode($updatedItem, JSON_UNESCAPED_UNICODE)
                ]);
            } catch (Exception $e) {}
        }

        // Update JSON
        writeJsonFileSafely($dataFile, $all);

        echo json_encode([
            "status" => "success",
            "message" => "تم تحديث الاستبيان بنجاح",
            "item" => $updatedItem,
            "count" => count($all)
        ], JSON_UNESCAPED_UNICODE);
        break;

    // ----------------------------------------------------
    // DELETE: Delete a single response
    // ----------------------------------------------------
    case 'delete':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $targetId = $inputData['id'] ?? ($_GET['id'] ?? '');
        if (empty($targetId)) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "رقم الاستبيان مطلوب للحذف."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if ($pdo !== null) {
            try {
                $stmt = $pdo->prepare("DELETE FROM responses WHERE id = :id");
                $stmt->execute([':id' => $targetId]);
            } catch (Exception $e) {}
        }

        $all = getAllResponses($pdo, $dataFile);
        $all = array_values(array_filter($all, function($item) use ($targetId) {
            return !isset($item['id']) || $item['id'] !== $targetId;
        }));

        writeJsonFileSafely($dataFile, $all);

        echo json_encode([
            "status" => "success",
            "message" => "تم حذف الاستبيان بنجاح",
            "id" => $targetId,
            "remaining" => count($all)
        ], JSON_UNESCAPED_UNICODE);
        break;

    // ----------------------------------------------------
    // CLEAR: Zero-out all responses
    // ----------------------------------------------------
    case 'clear':
    case 'reset':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if ($pdo !== null) {
            try {
                $pdo->exec("DELETE FROM responses");
            } catch (Exception $e) {}
        }

        writeJsonFileSafely($dataFile, []);

        echo json_encode([
            "status" => "cleared",
            "message" => "تم تصفير وحذف جميع الاستبيانات بنجاح من السيرفر",
            "count" => 0
        ], JSON_UNESCAPED_UNICODE);
        break;

    // ----------------------------------------------------
    // ADMINS_GET: List all supervisors
    // ----------------------------------------------------
    case 'admins_get':
    case 'admins_list':
    case 'get_admins':
        $admins = getAllAdmins($pdo, $adminsFile);
        echo json_encode($admins, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        break;

    // ----------------------------------------------------
    // ADMIN_LOGIN: Authenticate supervisor account
    // ----------------------------------------------------
    case 'admin_login':
    case 'auth_admin':
    case 'admin_auth':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $username = trim($inputData['username'] ?? '');
        $password = trim($inputData['password'] ?? '');

        if (empty($username) || empty($password)) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "اسم المستخدم وكلمة المرور مطلوبان."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $matched = authAdmin($pdo, $adminsFile, $username, $password);
        if ($matched !== null) {
            echo json_encode([
                "status"  => "success",
                "message" => "تم تسجيل الدخول بنجاح كـ (" . ($matched['fullName'] ?? $matched['username']) . ")",
                "user"    => [
                    "username" => $matched['username'],
                    "fullName" => $matched['fullName'],
                    "role"     => $matched['role'],
                    "province" => $matched['province']
                ]
            ], JSON_UNESCAPED_UNICODE);
        } else {
            http_response_code(401);
            echo json_encode([
                "status"  => "error",
                "message" => "بيانات الدخول غير صحيحة. يرجى التأكد من اسم المستخدم وكلمة المرور."
            ], JSON_UNESCAPED_UNICODE);
        }
        break;

    // ----------------------------------------------------
    // ADMIN_CREATE: Add a new supervisor account
    // ----------------------------------------------------
    case 'admin_create':
    case 'add_admin':
    case 'create_admin':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $username = trim($inputData['username'] ?? '');
        $password = trim($inputData['password'] ?? '');
        $fullName = trim($inputData['fullName'] ?? '');
        $role     = trim($inputData['role'] ?? 'SUPERVISOR');
        $province = trim($inputData['province'] ?? 'كربلاء المقدسة');

        if (empty($username) || mb_strlen($username, 'UTF-8') < 3) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "اسم المستخدم مطلوب ويجب ألا يقل عن 3 أحرف."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if (empty($password) || mb_strlen($password, 'UTF-8') < 4) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "كلمة المرور مطلوبة ويجب ألا تقل عن 4 خانات."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $admins = getAllAdmins($pdo, $adminsFile);
        $checkUser = mb_strtolower($username, 'UTF-8');
        foreach ($admins as $adm) {
            if (mb_strtolower(trim($adm['username']), 'UTF-8') === $checkUser) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "اسم المستخدم ($username) مسجل مسبقاً لمشرف آخر. يرجى اختيار اسم مستخدم مختلف."], JSON_UNESCAPED_UNICODE);
                exit;
            }
        }

        $newAdmin = [
            'username'  => $username,
            'password'  => $password,
            'fullName'  => !empty($fullName) ? $fullName : ('مشرف ' . $username),
            'role'      => !empty($role) ? $role : 'SUPERVISOR',
            'province'  => !empty($province) ? $province : 'كربلاء المقدسة',
            'createdAt' => date('Y-m-d H:i:s')
        ];

        $admins[] = $newAdmin;
        $saved = saveAdminsList($pdo, $adminsFile, $admins);

        if ($saved) {
            echo json_encode([
                "status"  => "success",
                "message" => "تم إنشاء وتوثيق حساب المشرف الجديد بنجاح في السحابة",
                "admin"   => $newAdmin,
                "admins"  => $admins
            ], JSON_UNESCAPED_UNICODE);
        } else {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "تعذر حفظ حساب المشرف في السيرفر السحابي."], JSON_UNESCAPED_UNICODE);
        }
        break;

    // ----------------------------------------------------
    // ADMIN_UPDATE: Update an existing supervisor account
    // ----------------------------------------------------
    case 'admin_update':
    case 'edit_admin':
    case 'update_admin':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $username = trim($inputData['username'] ?? '');
        if (empty($username)) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "اسم مستخدم المشرف مطلوب للتعديل."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $admins = getAllAdmins($pdo, $adminsFile);
        $foundIdx = -1;
        $checkUser = mb_strtolower($username, 'UTF-8');
        foreach ($admins as $idx => $adm) {
            if (mb_strtolower(trim($adm['username']), 'UTF-8') === $checkUser) {
                $foundIdx = $idx;
                break;
            }
        }

        if ($foundIdx === -1) {
            http_response_code(404);
            echo json_encode(["status" => "error", "message" => "لم يتم العثور على حساب المشرف المطلوب."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if (isset($inputData['fullName'])) $admins[$foundIdx]['fullName'] = trim($inputData['fullName']);
        if (isset($inputData['role']))     $admins[$foundIdx]['role'] = trim($inputData['role']);
        if (isset($inputData['province'])) $admins[$foundIdx]['province'] = trim($inputData['province']);
        if (!empty($inputData['password'])) {
            if (mb_strlen($inputData['password'], 'UTF-8') >= 4) {
                $admins[$foundIdx]['password'] = trim($inputData['password']);
            }
        }

        saveAdminsList($pdo, $adminsFile, $admins);
        echo json_encode([
            "status"  => "success",
            "message" => "تم تحديث بيانات المشرف بنجاح في السحابة",
            "admin"   => $admins[$foundIdx],
            "admins"  => $admins
        ], JSON_UNESCAPED_UNICODE);
        break;

    // ----------------------------------------------------
    // ADMIN_CHANGE_PASSWORD: Change supervisor password
    // ----------------------------------------------------
    case 'admin_change_password':
    case 'change_password':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $username    = trim($inputData['username'] ?? '');
        $newPassword = trim($inputData['newPassword'] ?? ($inputData['password'] ?? ''));
        $oldPassword = isset($inputData['oldPassword']) ? trim($inputData['oldPassword']) : null;

        if (empty($username) || empty($newPassword) || mb_strlen($newPassword, 'UTF-8') < 4) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "كلمة المرور الجديدة مطلوبة ويجب ألا تقل عن 4 خانات."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $admins = getAllAdmins($pdo, $adminsFile);
        $foundIdx = -1;
        $checkUser = mb_strtolower($username, 'UTF-8');
        foreach ($admins as $idx => $adm) {
            if (mb_strtolower(trim($adm['username']), 'UTF-8') === $checkUser) {
                $foundIdx = $idx;
                break;
            }
        }

        if ($foundIdx === -1) {
            http_response_code(404);
            echo json_encode(["status" => "error", "message" => "لم يتم العثور على حساب المشرف."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if ($oldPassword !== null && $oldPassword !== '') {
            if ($admins[$foundIdx]['password'] !== $oldPassword) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "كلمة المرور الحالية غير صحيحة."], JSON_UNESCAPED_UNICODE);
                exit;
            }
        }

        $admins[$foundIdx]['password'] = $newPassword;
        saveAdminsList($pdo, $adminsFile, $admins);

        echo json_encode([
            "status"   => "success",
            "message"  => "تم تغيير وتحديث كلمة المرور بنجاح في السحابة",
            "username" => $admins[$foundIdx]['username']
        ], JSON_UNESCAPED_UNICODE);
        break;

    // ----------------------------------------------------
    // ADMIN_DELETE: Delete a supervisor account
    // ----------------------------------------------------
    case 'admin_delete':
    case 'delete_admin':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $username = trim($inputData['username'] ?? '');
        if (empty($username)) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "اسم مستخدم المشرف مطلوب للحذف."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if (mb_strtolower($username, 'UTF-8') === 'admin') {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "لا يمكن حذف حساب المشرف العام الرئيسي الافتراضي للنظام (admin)."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $admins = getAllAdmins($pdo, $adminsFile);
        if (count($admins) <= 1) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "لا يمكن حذف الحساب. يجب الإبقاء على حساب مشرف واحد على الأقل."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $checkUser = mb_strtolower($username, 'UTF-8');
        $newAdmins = array_values(array_filter($admins, function($adm) use ($checkUser) {
            return mb_strtolower(trim($adm['username']), 'UTF-8') !== $checkUser;
        }));

        if (count($newAdmins) === count($admins)) {
            http_response_code(404);
            echo json_encode(["status" => "error", "message" => "حساب المشرف غير موجود أو تم حذفه مسبقاً."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        saveAdminsList($pdo, $adminsFile, $newAdmins);

        echo json_encode([
            "status"  => "success",
            "message" => "تم حذف حساب المشرف بنجاح من السحابة",
            "admins"  => $newAdmins
        ], JSON_UNESCAPED_UNICODE);
        break;

    // ----------------------------------------------------
    // DIAGNOSTIC & HEALTH CHECK: Server and Permissions Status
    // ----------------------------------------------------
    case 'diagnostic':
    case 'health':
    case 'status':
    case 'test':
        $all = getAllResponses($pdo, $dataFile);
        $allAdmins = getAllAdmins($pdo, $adminsFile);
        $dirWritable = is_writable(__DIR__);
        $jsonWritable = is_writable($dataFile) || (!file_exists($dataFile) && $dirWritable);
        $adminsWritable = is_writable($adminsFile) || (!file_exists($adminsFile) && $dirWritable);
        $sqliteSupported = extension_loaded('pdo') && in_array('sqlite', PDO::getAvailableDrivers());

        echo json_encode([
            "status"          => "ok",
            "serverTime"      => date('Y-m-d H:i:s'),
            "phpVersion"      => PHP_VERSION,
            "serverSoftware"  => $_SERVER['SERVER_SOFTWARE'] ?? 'Unknown Server',
            "sqliteSupported" => $sqliteSupported,
            "sqliteActive"    => ($pdo !== null),
            "jsonExists"      => file_exists($dataFile),
            "jsonWritable"    => $jsonWritable,
            "adminsExists"    => file_exists($adminsFile),
            "adminsWritable"  => $adminsWritable,
            "dirWritable"     => $dirWritable,
            "dataFile"        => basename($dataFile),
            "adminsFile"      => basename($adminsFile),
            "dbFile"          => basename($dbFile),
            "storageEngine"   => ($pdo !== null ? "SQLite + JSON (مزدوج عالي الاعتمادية)" : "JSON File Only"),
            "count"           => count($all),
            "adminsCount"     => count($allAdmins),
            "healthy"         => ($pdo !== null || $jsonWritable)
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        break;

    // ----------------------------------------------------
    // REPAIR: Automatically fix file permissions and sync
    // ----------------------------------------------------
    case 'repair':
        $logs = [];
        if (file_exists($dataFile)) {
            @chmod($dataFile, 0666);
            $logs[] = "تم تعيين أذونات 0666 لملف responses.json";
        }
        if (file_exists($adminsFile)) {
            @chmod($adminsFile, 0666);
            $logs[] = "تم تعيين أذونات 0666 لملف admins.json";
        }
        if (file_exists($dbFile)) {
            @chmod($dbFile, 0666);
            if (file_exists($dbFile . '-wal')) @chmod($dbFile . '-wal', 0666);
            if (file_exists($dbFile . '-shm')) @chmod($dbFile . '-shm', 0666);
            $logs[] = "تم تعيين أذونات 0666 لقاعدة البيانات shrine_data.db وملفاتها الملحقة";
        }
        @chmod(__DIR__, 0755);

        // Resync
        $all = getAllResponses($pdo, $dataFile);
        writeJsonFileSafely($dataFile, $all);

        $allAdmins = getAllAdmins($pdo, $adminsFile);
        saveAdminsList($pdo, $adminsFile, $allAdmins);

        echo json_encode([
            "status"      => "repaired",
            "message"     => "تم فحص وإصلاح أذونات السيرفر ومزامنة قاعدة البيانات وحسابات المشرفين بنجاح",
            "logs"        => $logs,
            "count"       => count($all),
            "adminsCount" => count($allAdmins)
        ], JSON_UNESCAPED_UNICODE);
        break;

    default:
        http_response_code(400);
        echo json_encode([
            "status" => "error",
            "message" => "إجراء غير معروف. الإجراءات المتاحة: get, submit, update, delete, clear, admins_get, admin_login, admin_create, admin_update, admin_change_password, admin_delete, diagnostic, repair."
        ], JSON_UNESCAPED_UNICODE);
        break;
}
