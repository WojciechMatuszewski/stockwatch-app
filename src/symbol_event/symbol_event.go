package symbol_event

import (
	"encoding/json"
	"errors"
)

const (
	PRICE_DELTA_EVENT_TYPE = "price_delta"
	PRICE_EVENT_TYPE       = "price"
)

type Event struct {
	Type string `json:"type"`
}

func (e Event) IsPriceDeltaEvent() bool {
	return e.Type == PRICE_DELTA_EVENT_TYPE
}

func (e Event) IsPriceEvent() bool {
	return e.Type == PRICE_EVENT_TYPE
}

type PriceDeltaEvent struct {
	Symbol string  `json:"symbol"`
	Delta  float64 `json:"delta"`
	Type   string  `json:"type"`
}

func NewPriceDeltaEvent(symbol string, delta float64) PriceDeltaEvent {
	return PriceDeltaEvent{
		Symbol: symbol,
		Delta:  delta,
		Type:   PRICE_DELTA_EVENT_TYPE,
	}
}

func (e *PriceDeltaEvent) UnmarshalJSON(b []byte) error {
	type _SymbolPriceDeltaEvent PriceDeltaEvent

	err := json.Unmarshal(b, (*_SymbolPriceDeltaEvent)(e))
	if err != nil {
		return err
	}

	if e.Symbol == "" {
		return errors.New("empty symbol")
	}

	return nil
}

type PriceEvent struct {
	Symbol string  `json:"symbol"`
	Price  float64 `json:"price"`
	Type   string  `json:"type"`
}

func NewPriceEvent(symbol string, price float64) PriceEvent {
	return PriceEvent{
		Symbol: symbol,
		Price:  price,
		Type:   PRICE_EVENT_TYPE,
	}
}

func (e *PriceEvent) UnmarshalJSON(b []byte) error {
	type _SymbolPriceEvent PriceEvent

	err := json.Unmarshal(b, (*_SymbolPriceEvent)(e))
	if err != nil {
		return err
	}

	if e.Symbol == "" {
		return errors.New("empty symbol")
	}

	return nil
}
