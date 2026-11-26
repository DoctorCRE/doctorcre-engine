-- The towns inside the three markets named for an area, as the owner ruled on #1374. Run after add-market-cities.sql.
-- A market not yet present gets no towns, and a town already listed is kept, so this can run again.
begin;
set local search_path = next, pg_temp;
select set_config('engine.job', 'agent', true), set_config('engine.user_id', '', true);

insert into market_city (market_id, city)
select m.id, town.city
from (values
	('Orange Beach / Gulf Shores', 'Orange Beach'),
	('Orange Beach / Gulf Shores', 'Gulf Shores'),
	('Eastern Shore', 'Daphne'),
	('Eastern Shore', 'Fairhope'),
	('Eastern Shore', 'Spanish Fort'),
	('Eastern Shore', 'Montrose'),
	('Eastern Shore', 'Point Clear'),
	('30A / Santa Rosa Beach', 'Santa Rosa Beach'),
	('30A / Santa Rosa Beach', 'Seaside'),
	('30A / Santa Rosa Beach', 'WaterColor'),
	('30A / Santa Rosa Beach', 'Grayton Beach'),
	('30A / Santa Rosa Beach', 'Seagrove Beach'),
	('30A / Santa Rosa Beach', 'Rosemary Beach'),
	('30A / Santa Rosa Beach', 'Alys Beach'),
	('30A / Santa Rosa Beach', 'Inlet Beach'),
	('30A / Santa Rosa Beach', 'Blue Mountain Beach'),
	('30A / Santa Rosa Beach', 'Dune Allen')
) town (market, city)
join market m on m.name = town.market
on conflict do nothing;

commit;
