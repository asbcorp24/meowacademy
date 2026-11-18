<?php
declare(strict_types=1);

/** Validate a canonical mono 16-bit PCM WAV upload without trusting browser metadata. */
function catWavDuration(string $path): ?float {
    $size = filesize($path);
    if ($size === false || $size < 44 || $size > 800000) return null;
    $handle = fopen($path, 'rb');
    if (!$handle) return null;
    try {
        $header = fread($handle, 12);
        if (strlen($header) !== 12 || substr($header, 0, 4) !== 'RIFF' || substr($header, 8, 4) !== 'WAVE') return null;
        $declared = unpack('V', substr($header, 4, 4))[1];
        if ($declared + 8 !== $size) return null;
        $format = null; $dataLength = null;
        while (ftell($handle) + 8 <= $size) {
            $chunk = fread($handle, 8);
            if (strlen($chunk) !== 8) return null;
            $length = unpack('V', substr($chunk, 4, 4))[1];
            $offset = ftell($handle);
            if ($length > $size - $offset || $offset + $length + ($length % 2) > $size) return null;
            $type = substr($chunk, 0, 4);
            if ($type === 'fmt ') {
                if ($length < 16 || $length > 128 || $format !== null) return null;
                $format = unpack('vcodec/vchannels/Vrate/VbytesPerSec/valign/vbits', fread($handle, 16));
            }
            if ($type === 'data') {
                if ($dataLength !== null) return null;
                $dataLength = $length;
            }
            if (fseek($handle, $offset + $length + ($length % 2)) !== 0) return null;
        }
        if ($format === null || $dataLength === null || ftell($handle) !== $size) return null;
        if ($format['codec'] !== 1 || $format['channels'] !== 1 || $format['rate'] !== 16000 || $format['bits'] !== 16 || $format['align'] !== 2 || $format['bytesPerSec'] !== 32000) return null;
        if ($dataLength % 2) return null;
        $duration = $dataLength / 32000;
        return $duration > 0 && $duration <= 10.0001 ? $duration : null;
    } finally { fclose($handle); }
}

function catFeaturesValid(mixed $features, float $duration): bool {
    if (!is_array($features) || ($features['version'] ?? null) !== 2 || !is_array($features['frames'] ?? null) || count($features['frames']) > 1000) return false;
    foreach ($features['frames'] as $frame) {
        if (!is_array($frame) || !is_numeric($frame['t'] ?? null) || (float)$frame['t'] < 0 || (float)$frame['t'] > $duration + .1) return false;
        if (!is_numeric($frame['rms'] ?? null) || $frame['rms'] < 0 || $frame['rms'] > 2) return false;
        if (isset($frame['f0']) && (!is_numeric($frame['f0']) || $frame['f0'] < 0 || $frame['f0'] > 5000)) return false;
    }
    return true;
}
