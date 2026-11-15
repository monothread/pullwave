import { MAX_SEASON, MAX_SEASON_NAME_LENGTH, foldSeries, sameSeries } from '@shared/series';
import { useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { FieldShell, NumberField, TextField } from './fields';

interface SeriesFieldsProps {
    series: string;
    season: number;
    seasonName: string;
    suggestions: readonly string[];
    onSeriesChange: (series: string) => void;
    onSeasonChange: (season: number) => void;
    onSeasonNameChange: (name: string) => void;
    hint?: string;
    nameHint?: string;
    seriesPlaceholder?: string;
    seasonProblem?: string;
}

interface SeriesSearchProps {
    label: string;
    value: string;
    placeholder: string;
    suggestions: readonly string[];
    onChange: (series: string) => void;
}

function SeriesSearch({ label, value, placeholder, suggestions, onChange }: SeriesSearchProps) {
    const t = useTranslator();
    const existing = t('anime.series.existing');
    const [open, setOpen] = useState(false);
    const typed = foldSeries(value);
    const matches = suggestions.filter((name) => {
        return foldSeries(name).includes(typed) && !sameSeries(name, value);
    });
    return (
        <FieldShell label={label}>
            <div className="series-search">
                <input
                    className="input"
                    type="text"
                    aria-label={label}
                    aria-autocomplete="list"
                    value={value}
                    placeholder={placeholder}
                    onFocus={() => {
                        setOpen(true);
                    }}
                    onBlur={() => {
                        setOpen(false);
                    }}
                    onChange={(event) => {
                        setOpen(true);
                        onChange(event.target.value);
                    }}
                />
                {open && matches.length > 0 && (
                    <ul className="series-search__list" role="listbox" aria-label={existing}>
                        {matches.map((name) => {
                            return (
                                <li
                                    key={name}
                                    role="option"
                                    aria-selected={false}
                                    className="series-search__option"
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        onChange(name);
                                        setOpen(false);
                                    }}
                                >
                                    {name}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </FieldShell>
    );
}

export function SeriesFields({ series, season, seasonName, suggestions, onSeriesChange, onSeasonChange, onSeasonNameChange, hint, nameHint, seriesPlaceholder, seasonProblem }: SeriesFieldsProps) {
    const t = useTranslator();
    return (
        <div className="series-picker">
            <div className="field-row series-fields" title={hint ?? t('anime.series.hint')}>
                <SeriesSearch label={t('anime.series.label')} value={series} placeholder={seriesPlaceholder ?? t('anime.series.placeholder')} suggestions={suggestions} onChange={onSeriesChange} />
                <NumberField label={t('anime.season.label')} value={season} min={1} max={MAX_SEASON} onChange={onSeasonChange} />
            </div>
            {seasonProblem !== undefined && (
                <p className="field__warning" role="alert">
                    {seasonProblem}
                </p>
            )}
            <div className="field-row series-name" title={nameHint ?? t('anime.series.nameHint')}>
                <TextField
                    label={t('anime.season.name')}
                    value={seasonName}
                    placeholder={t('anime.season.namePlaceholder', { number: season })}
                    onChange={(value) => {
                        onSeasonNameChange(value.slice(0, MAX_SEASON_NAME_LENGTH));
                    }}
                />
            </div>
        </div>
    );
}
