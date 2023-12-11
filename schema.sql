create table repositories (
	name       text    not null,
	created_at integer not null default current_timestamp,
	primary key (name)
);

create table manifests (
	repository text    not null,
	digest     text    not null,
	tag        text,
	created_at integer not null default current_timestamp,
	updated_at integer not null default current_timestamp,
	primary key (repository, digest),
	foreign key (repository) references repositories (name)
);
create index manifests_repository_tag_idx on manifests (repository, tag);
create unique index manifests_repository_tag_key on manifests (repository, tag);
