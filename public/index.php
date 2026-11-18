<?php
if (PHP_SAPI === 'cli-server' && is_file(__DIR__.parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))) return false;
require __DIR__.'/../src/bootstrap.php';
require __DIR__.'/../src/cat_upload.php';
$path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);
if($path==='/cats' && $_SERVER['REQUEST_METHOD']==='GET'){readfile(__DIR__.'/cats.html');exit;}
if($path==='/api/cats' && $_SERVER['REQUEST_METHOD']==='GET'){
 $rows=$db->query('SELECT id,cat_name,audio_path,duration,created_at FROM cat_sounds WHERE status="approved" ORDER BY id DESC LIMIT 60')->fetchAll(PDO::FETCH_ASSOC);jsonResponse($rows);
}
if($path==='/api/cats' && $_SERVER['REQUEST_METHOD']==='POST'){
 if(!hash_equals(csrf(),(string)($_SERVER['HTTP_X_CSRF_TOKEN']??'')))jsonResponse(['error'=>'Сессия устарела. Обнови страницу.'],403);
 $file=$_FILES['audio']??null;$name=trim((string)($_POST['cat_name']??''));
 if(!$file||$file['error']!==UPLOAD_ERR_OK||!is_uploaded_file($file['tmp_name'])||$file['size']>800000||$file['size']<44||$name===''||mb_strlen($name)>60)jsonResponse(['error'=>'Проверь имя котика и размер аудио.'],422);
 $duration=catWavDuration($file['tmp_name']);
 if($duration===null)jsonResponse(['error'=>'Нужен WAV до 10 секунд (16 кГц, моно PCM).'],422);
 $raw=(string)($_POST['features']??'');
 if(strlen($raw)>350000)jsonResponse(['error'=>'Акустические данные слишком большие.'],422);
 $features=json_decode($raw,true);
 if(!catFeaturesValid($features,$duration))jsonResponse(['error'=>'Не удалось проверить параметры звука.'],422);
 $ipHash=hash('sha256',(string)($_SERVER['REMOTE_ADDR']??'unknown'));
 $limit=$db->prepare('SELECT COUNT(*) FROM cat_sounds WHERE uploader_hash=? AND created_at>=datetime("now", "-1 hour")');$limit->execute([$ipHash]);
 if((int)$limit->fetchColumn()>=5)jsonResponse(['error'=>'Можно загрузить не больше 5 мяуканий в час.'],429);
 $filename=bin2hex(random_bytes(16)).'.wav';$target=ROOT.'/storage/uploads/'.$filename;
 if(!move_uploaded_file($file['tmp_name'],$target))jsonResponse(['error'=>'Не получилось сохранить файл.'],500);
 $stmt=$db->prepare('INSERT INTO cat_sounds(cat_name,audio_path,duration,features,status,uploader_hash) VALUES(?,?,?,?,"pending",?)');
 try{$stmt->execute([$name,'/audio/'.$filename,$duration,json_encode($features,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$ipHash]);}
 catch(Throwable $e){unlink($target);throw $e;}
 jsonResponse(['ok'=>true,'message'=>'Мяуканье отправлено на проверку!'],201);
}
if($path==='/api/csrf' && $_SERVER['REQUEST_METHOD']==='GET')jsonResponse(['csrf'=>csrf()]);
if($path==='/api/lessons'){ $rows=$db->query('SELECT id,title,description,audio_path,features FROM lessons ORDER BY id DESC')->fetchAll(PDO::FETCH_ASSOC);jsonResponse($rows); }
if($path==='/api/attempt' && $_SERVER['REQUEST_METHOD']==='POST'){
 $data=json_decode(file_get_contents('php://input'),true);if(!is_array($data)||!isset($data['lesson_id'],$data['score'],$data['details'])||!is_numeric($data['score'])||$data['score']<0||$data['score']>100)jsonResponse(['error'=>'Invalid input'],422);
 $st=$db->prepare('INSERT INTO attempts(lesson_id,score,details) VALUES(?,?,?)');$st->execute([(int)$data['lesson_id'],(float)$data['score'],json_encode($data['details'],JSON_UNESCAPED_UNICODE)]);jsonResponse(['ok'=>true]);
}
if($path==='/admin'){
 if(empty($_SESSION['admin'])) {header('Location: /login');exit;}
 if($_SERVER['REQUEST_METHOD']==='POST' && isset($_POST['cat_review'])){
 requireCsrf();$id=filter_var($_POST['cat_review'],FILTER_VALIDATE_INT);$action=(string)($_POST['decision']??'');
 if(!$id||!in_array($action,['approve','reject'],true)){http_response_code(422);exit('Invalid review');}
 $db->beginTransaction();
 try{
  $st=$db->prepare('SELECT * FROM cat_sounds WHERE id=? AND status="pending"');$st->execute([$id]);$cat=$st->fetch(PDO::FETCH_ASSOC);
  if(!$cat){$db->rollBack();http_response_code(404);exit('Not found');}
  if($action==='approve'){
   $st=$db->prepare('INSERT INTO lessons(title,description,audio_path,features) VALUES(?,?,?,?)');
   $st->execute(['🐱 '.$cat['cat_name'],'Мяуканье домашнего котика · '.round((float)$cat['duration'],1).' сек.',$cat['audio_path'],$cat['features']]);
  }
  $st=$db->prepare('UPDATE cat_sounds SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?');$st->execute([$action==='approve'?'approved':'rejected',$id]);
  $db->commit();
 }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
 header('Location: /admin');exit;
 }
 if($_SERVER['REQUEST_METHOD']==='POST'){
 requireCsrf();$file=$_FILES['audio']??null;$title=trim((string)($_POST['title']??''));
 if(!$file||$file['error']!==UPLOAD_ERR_OK||$file['size']>12000000||$title===''||mb_strlen($title)>120){http_response_code(422);exit('Invalid upload');}
 $mime=(new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);$ext=['audio/mpeg'=>'mp3','audio/wav'=>'wav','audio/x-wav'=>'wav','audio/ogg'=>'ogg','application/ogg'=>'ogg'][$mime]??null;
 if(!$ext){http_response_code(422);exit('Unsupported audio format');}
 $name=bin2hex(random_bytes(16)).'.'.$ext;if(!move_uploaded_file($file['tmp_name'],ROOT.'/storage/uploads/'.$name)){http_response_code(500);exit('Upload failed');}
 $raw=(string)($_POST['features']??'');if(strlen($raw)>3000000){http_response_code(422);exit('Features too large');}$features=json_decode($raw,true);if(!is_array($features)||($features['version']??null)!==2||!isset($features['frames'])||!is_array($features['frames'])||count($features['frames'])>5000){http_response_code(422);exit('Invalid acoustic features');}
 $st=$db->prepare('INSERT INTO lessons(title,description,audio_path,features) VALUES(?,?,?,?)');$st->execute([$title,trim((string)($_POST['description']??'')),'/audio/'.$name,json_encode($features)]);header('Location: /admin');exit;
 }
 $rows=$db->query('SELECT id,title,created_at FROM lessons ORDER BY id DESC')->fetchAll(PDO::FETCH_ASSOC);
 $pending=$db->query('SELECT id,cat_name,audio_path,duration FROM cat_sounds WHERE status="pending" ORDER BY id ASC LIMIT 100')->fetchAll(PDO::FETCH_ASSOC);
 echo '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/style.css"><main class="shell"><a href="/">← На главную</a><h1>🐾 Админка МяуАкадемии</h1><section class="panel"><h2>Новый эталон</h2><form method="post" enctype="multipart/form-data"><input type="hidden" name="csrf" value="'.htmlspecialchars(csrf()).'"><label>Название<input name="title" maxlength="120" required></label><label>Описание<textarea name="description"></textarea></label><label>Аудио (MP3, WAV, OGG до 12 МБ)<input name="audio" type="file" accept="audio/*" required></label><input type="hidden" name="features" value="{}"><button>Добавить урок</button></form></section><section class="panel"><h2>Уроки</h2>';
 foreach($rows as $row)echo '<p>#'.(int)$row['id'].' — '.htmlspecialchars($row['title']).'</p>';echo '</section><section class="panel"><h2>🐾 Мяуканья пользователей на проверке ('.count($pending).')</h2>';
 foreach($pending as $cat){echo '<div class="cat-review"><strong>'.htmlspecialchars($cat['cat_name'],ENT_QUOTES,'UTF-8').'</strong> · '.round((float)$cat['duration'],1).' сек.<audio controls preload="none" src="'.htmlspecialchars($cat['audio_path'],ENT_QUOTES,'UTF-8').'"></audio><form method="post"><input type="hidden" name="csrf" value="'.htmlspecialchars(csrf(),ENT_QUOTES,'UTF-8').'"><input type="hidden" name="cat_review" value="'.(int)$cat['id'].'"><button name="decision" value="approve">✅ Одобрить и добавить в уроки</button> <button name="decision" value="reject">✖ Отклонить</button></form></div>';}
 if(!$pending)echo '<p>Новых записей пока нет.</p>';
 echo '</section></main><script type="module" src="/assets/admin.js"></script></html>';exit;
}
if($path==='/login'){
 if($_SERVER['REQUEST_METHOD']==='POST'){
  requireCsrf();
  $passwordFile=ROOT.'/storage/admin_password.txt';
  $expected=is_readable($passwordFile)?trim((string)file_get_contents($passwordFile)):'';
  if(strlen($expected)>=12&&hash_equals($expected,(string)($_POST['password']??''))){
   session_regenerate_id(true);$_SESSION['admin']=true;header('Location: /admin');exit;
  }
  $error='Неверный пароль или файл пароля не настроен';
 }
 echo '<!doctype html><html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/assets/style.css"><main class="shell"><h1>🐱 Вход администратора</h1><form class="panel" method="post"><input type="hidden" name="csrf" value="'.htmlspecialchars(csrf()).'"><input type="password" name="password" placeholder="Пароль" required><button>Войти</button></form>'.htmlspecialchars($error??'').'</main></html>';exit;
}
if(preg_match('~^/audio/([a-f0-9]{32}\.(?:mp3|wav|ogg))$~',$path,$m)){$file=ROOT.'/storage/uploads/'.$m[1];if(!is_file($file)){http_response_code(404);exit;}header('Content-Type: '.(['mp3'=>'audio/mpeg','wav'=>'audio/wav','ogg'=>'audio/ogg'][pathinfo($file,PATHINFO_EXTENSION)]));header('X-Content-Type-Options: nosniff');readfile($file);exit;}
if($path==='/realtime'){readfile(__DIR__.'/realtime.html');exit;}
if($path!=='/'){http_response_code(404);exit('Not found');}
readfile(__DIR__.'/app.html');
