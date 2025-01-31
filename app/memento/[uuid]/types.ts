export type MediaSources = {
    outputs: string[],
    materials: string[]
}

export type Memento = {
    uuid: string,
    created_at: string,
    updated_at: string,
    medias: MediaSources,
    revenue: number,
    additional: string
}