<?php
declare(strict_types=1);
session_start();
const ROOT = __DIR__ . '/..';
foreach ([ROOT.'/storage/db',ROOT.'/storage/uploads'] as $dir) if (!is_dir($dir)) mkdir($dir,0770,true);
$db = new PDO('sqlite:'.ROOT.'/storage/db/meowacademy.sqlite');
$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
$db->exec('PRAGMA foreign_keys=ON');
$db->exec('CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT "", audio_path TEXT NOT NULL, features TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
$db->exec('CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY, lesson_id INTEGER NOT NULL, score REAL NOT NULL, details TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(lesson_id) REFERENCES lessons(id))');
function csrf():string {return $_SESSION['csrf'] ??= bin2hex(random_bytes(24));}
function requireCsrf():void {if(!hash_equals(csrf(),(string)($_POST['csrf']??''))) {http_response_code(403);exit('CSRF');}}
function jsonResponse(mixed $v,int $code=200):never {http_response_code($code);header('Content-Type: application/json; charset=utf-8');echo json_encode($v,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);exit;}
