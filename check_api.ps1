
try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:5001/api/products?page=1&limit=10&search=" -Method Get -ErrorAction Stop
  $response.Content | Out-File -FilePath "api_response.txt" -Encoding utf8
} catch {
  if ($_.Exception.Response) {
      $status = $_.Exception.Response.StatusCode
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $body = $reader.ReadToEnd()
      "$status`n$body" | Out-File -FilePath "api_response.txt" -Encoding utf8
  } else {
      $_.Exception.Message | Out-File -FilePath "api_response.txt" -Encoding utf8
  }
}
