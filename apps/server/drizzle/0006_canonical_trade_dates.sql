-- Date-only broker rows (Dhan statement, dividends, US brokers) used to be read in the server's
-- timezone, so on an Indian machine "01 Apr 2025" was stored as 2025-03-31T18:30Z: a day early,
-- and a 1 April trade fell into the previous financial year. Move them to UTC midnight of the
-- printed date — the convention every importer now follows. No exchange trades at 00:00 IST, so
-- exactly 18:30:00.000Z only ever comes from that bug. Binance times really are UTC; left alone.
UPDATE `transactions`
SET `trade_date` = strftime('%Y-%m-%dT00:00:00.000Z', `trade_date`, '+330 minutes')
WHERE `trade_date` LIKE '____-__-__T18:30:00.000Z'
  AND (`source_broker` IS NULL OR `source_broker` <> 'binance');
